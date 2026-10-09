"""Release helpers. AWS credentials and application secrets stay in process memory.

Requires boto3, AWS CLI v2 and an authenticated profile. Does not execute change sets.
"""
import argparse
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import tempfile

import boto3


def session(profile, region):
    cli = os.environ.get("AWS_CLI") or shutil.which("aws")
    if not cli:
        raise RuntimeError("Set AWS_CLI to the installed AWS CLI executable")
    result = subprocess.run(
        [cli, "configure", "export-credentials", "--profile", profile, "--format", "process"],
        capture_output=True, text=True, check=False,
    )
    if result.returncode:
        raise RuntimeError("AWS profile credentials unavailable")
    credentials = json.loads(result.stdout)
    return boto3.Session(
        aws_access_key_id=credentials["AccessKeyId"],
        aws_secret_access_key=credentials["SecretAccessKey"],
        aws_session_token=credentials.get("SessionToken"),
        region_name=region,
    )


def create_secret(aws, name, env_file):
    # Node's built-in parser handles quoted and multiline dotenv values correctly.
    parsed = subprocess.run(
        ["node", "--input-type=module", "-e",
         "import{readFileSync}from'node:fs';import{parseEnv}from'node:util';"
         "process.stdout.write(JSON.stringify(parseEnv(readFileSync(process.argv[1],'utf8'))))",
         str(env_file)], capture_output=True, text=True, check=True,
    )
    key = json.loads(parsed.stdout).get("OPENAI_API_KEY")
    if not key:
        raise RuntimeError("OPENAI_API_KEY is missing")
    client = aws.client("secretsmanager")
    try:
        metadata = client.describe_secret(SecretId=name)
        return {"secretArn": metadata["ARN"], "created": False}
    except client.exceptions.ResourceNotFoundException:
        created = client.create_secret(
            Name=name,
            Description="Pulda application credentials; no patient data",
            SecretString=json.dumps({"OPENAI_API_KEY": key, "SESSION_SECRET": secrets.token_urlsafe(48)}),
            Tags=[{"Key": "Application", "Value": "pulda"}],
        )
        return {"secretArn": created["ARN"], "created": True}


def plan(aws, args):
    config = json.loads(Path(args.parameters).read_text(encoding="utf-8-sig"))
    if not config["ImageUri"].split("@")[-1].startswith("sha256:"):
        raise RuntimeError("Release requires an immutable image digest")
    cfn = aws.client("cloudformation")
    template = Path(args.template).read_text(encoding="utf-8")
    cfn.validate_template(TemplateBody=template)
    result = cfn.create_change_set(
        StackName=args.stack, ChangeSetName=args.change_set,
        ChangeSetType=args.change_type, TemplateBody=template,
        Parameters=[{"ParameterKey": key, "ParameterValue": str(value)} for key, value in config.items()],
        Capabilities=["CAPABILITY_IAM"],
        Tags=[{"Key": "Application", "Value": "pulda"}],
    )
    return {"changeSetId": result["Id"], "stackId": result["StackId"]}


def push_image(aws, args):
    ecr = aws.client("ecr")
    repository = ecr.describe_repositories(repositoryNames=[args.repository])["repositories"][0]
    destination = repository["repositoryUri"] + ":" + args.tag
    registry = repository["repositoryUri"].split("/")[0]
    auth = ecr.get_authorization_token(registryIds=[repository["registryId"]])["authorizationData"][0]
    # Isolate auth from broken desktop credential helpers. Always remove the temporary token.
    with tempfile.TemporaryDirectory(prefix="pulda-ecr-") as directory:
        Path(directory, "config.json").write_text(
            json.dumps({"auths": {registry: {"auth": auth["authorizationToken"]}}}), encoding="utf-8"
        )
        subprocess.run(["docker", "tag", args.image, destination], check=True)
        subprocess.run(["docker", "--config", directory, "push", destination], check=True)
    image = ecr.describe_images(repositoryName=args.repository, imageIds=[{"imageTag": args.tag}])["imageDetails"][0]
    return {"imageUri": repository["repositoryUri"] + "@" + image["imageDigest"]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", default=os.environ.get("AWS_PROFILE", "default"))
    parser.add_argument("--region", default="ap-southeast-2")
    sub = parser.add_subparsers(dest="action", required=True)
    secret = sub.add_parser("secret")
    secret.add_argument("--name", default="pulda/production")
    secret.add_argument("--env-file", default=".env")
    push = sub.add_parser("push")
    push.add_argument("--repository", default="pulda")
    push.add_argument("--image", required=True)
    push.add_argument("--tag", required=True)
    change = sub.add_parser("plan")
    change.add_argument("--parameters", required=True)
    change.add_argument("--template", default="infra/aws-express.yaml")
    change.add_argument("--stack", default="pulda-service")
    change.add_argument("--change-set", required=True)
    change.add_argument("--change-type", choices=["CREATE", "UPDATE"], default="CREATE")
    args = parser.parse_args()
    aws = session(args.profile, args.region)
    if args.action == "secret":
        output = create_secret(aws, args.name, args.env_file)
    elif args.action == "push":
        output = push_image(aws, args)
    else:
        output = plan(aws, args)
    print(json.dumps(output))
