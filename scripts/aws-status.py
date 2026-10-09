"""Read deployment status without printing environment variables or secret values."""
import argparse
import json
import os
from pathlib import Path
import runpy

from botocore.exceptions import ClientError

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--profile", default=os.environ.get("AWS_PROFILE", "default"))
parser.add_argument("--region", default="ap-southeast-2")
parser.add_argument("--stack", default="pulda-service")
args = parser.parse_args()
helpers = runpy.run_path(str(Path(__file__).with_name("aws-release.py")))
aws = helpers["session"](args.profile, args.region)
cfn = aws.client("cloudformation")
stack = cfn.describe_stacks(StackName=args.stack)["Stacks"][0]
resources = cfn.list_stack_resources(StackName=args.stack)["StackResourceSummaries"]
output = {
    "stackStatus": stack["StackStatus"],
    "outputs": {item["OutputKey"]: item["OutputValue"] for item in stack.get("Outputs", [])},
    "resources": [{"id": item["LogicalResourceId"], "status": item["ResourceStatus"]} for item in resources],
}
cluster = next((item.get("PhysicalResourceId") for item in resources if item["LogicalResourceId"] == "Cluster"), None)
if cluster:
    ecs = aws.client("ecs")
    try:
        services = ecs.describe_services(cluster=cluster, services=["pulda"])["services"]
        if services:
            service = services[0]
            output["service"] = {
                "arn": service["serviceArn"], "desired": service["desiredCount"],
                "running": service["runningCount"], "pending": service["pendingCount"],
                "events": [item["message"] for item in service.get("events", [])[:4]],
            }
            express = ecs.describe_express_gateway_service(serviceArn=service["serviceArn"])["service"]
            output["endpoint"] = [path["endpoint"] for config in express.get("activeConfigurations", []) for path in config.get("ingressPaths", [])]
    except ClientError as error:
        output["serviceLookup"] = error.response["Error"]["Code"]
print(json.dumps(output, indent=2, default=str))
