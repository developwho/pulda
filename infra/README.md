# AWS 운영 구성

## 병원 컨시어지 모듈

`concierge.yaml`은 새 병원 탐색·전화/문자 문의 흐름의 **미배포 SAM 템플릿**입니다. 현재 운영 스택과 별개입니다. S3 비공개 버킷 + CloudFront에서 프론트를 제공하고 `/api/concierge/*`는 HTTP API → Lambda → DynamoDB로 연결합니다. 검색 요청은 즉시 202로 응답하고 SQS 작업자가 OpenAI Agents SDK를 실행하므로 긴 검색을 HTTP API 응답 시간 안에 끝내려 하지 않습니다. 기존 `/api/*` 진료·전사·접수 창구 경로는 `ExistingApiHost`의 HTTPS 서버로 전달합니다. 기존 서버를 제거하는 전체 마이그레이션은 아닙니다.

### 동작과 데이터

- 검색은 GPT + OpenAI 웹 검색 + 구조화 출력으로 동작합니다. 공급자 검색 메타데이터에 실제 존재하는 URL만 병원 카드 출처로 허용합니다. 연락처는 출처 기반 제안이며 실시간 전화 검증을 뜻하지 않습니다. 전화번호만으로 SMS 수신 가능하다고 추정하지 않습니다.
- 문의는 초안 → 사용자가 내용·번호 확인 → 기기의 전화/문자 앱 열기 → 사용자가 문의 완료 기록 → 받은 답변 기록 순서입니다. 앱을 연 것만으로 발송·예약 성공 처리하지 않습니다. 사용자가 병원에서 확정받았다고 표시하고 날짜·시간을 입력해야 이번 진료의 예약 정보로 가져올 수 있습니다. 서비스가 직접 병원에 전화하거나 문자 발송하는 기능은 아직 없습니다.
- 상태는 서명된 익명 세션별 1시간입니다. 병원·문의·답변은 암호화된 DynamoDB에 저장되므로 서버리스 재시작 시에도 유지됩니다. 개인정보가 섞일 수 있는 본문·쿠키·모델 출력은 로그에 남기지 않습니다. SQS에는 해시 소유자와 요청 ID만 넣습니다. 조건부 쓰기와 버전 확인으로 중복 작업과 삭제 뒤 늦은 결과를 막습니다.
- AgentCore Memory는 기본 OFF입니다. `EnableAgentCoreMemory=true` 및 화면의 명시적 저장 선택 시 연락 방식·글 안내 선호 두 항목만 self-managed memory record로 저장합니다. 건강 정보, 이름, 전화번호, 문의 본문, 병원 답변을 Memory에 저장하거나 자동 추출 모델로 보내지 않습니다. 서비스 AI는 OpenAI GPT만 사용합니다.
- 현재 Memory는 로그인 계정의 영구 기억이 아닌 **이번 익명 세션의 명시적 선호**입니다. 1시간 만료 후 API 읽기는 즉시 차단하며, 1분 주기의 정리 작업이 상태와 외부 기억을 삭제합니다. 삭제 요청은 내용 없는 tombstone으로 먼저 접근을 차단합니다. 외부 삭제 실패 시 정리 작업이 재시도합니다. DynamoDB TTL은 하루 뒤 보조 삭제이며 정확한 물리 삭제 시각을 보장하지 않습니다. AgentCore `EventExpiryDuration`은 이벤트용으로, 이 코드의 장기 record 만료를 대신하지 않습니다. 정리 작업 실패 알람을 운영 수신 채널에 연결해야 합니다.
- OpenAI Responses 저장과 Agents tracing은 비활성화합니다. 이것이 공급자의 오용 방지 보관까지 해제한다는 뜻은 아닙니다. 검색어 외의 기존 진료 기록은 검색 에이전트로 자동 전달하지 않습니다.

### 로컬 검증과 배포 준비

```powershell
npm ci
npm test
npm run build
npm run build:concierge
cfn-lint infra/concierge.yaml
# 실제 GPT 검색 1회: 공개 병원 정보만 사용하며 OpenAI 사용료가 발생합니다.
node --env-file=.env scripts/smoke-concierge.mjs
```

로컬 `npm run dev`는 추가 AWS 리소스 없이 프로세스 메모리를 사용하며 재시작 시 문의가 초기화됩니다. Production에서는 `CONCIERGE_TABLE`이 없으면 해당 기능을 닫습니다. Lambda는 `CONCIERGE_QUEUE_URL`도 필수입니다. 번들 디렉터리 `build/concierge`에는 `index.cjs` 하나만 허용하여 `.env`·자격 증명·저장소 원본이 Lambda 패키지로 들어가지 않게 합니다.

SAM CLI가 설치된 환경에서 프로젝트 리전 `ap-southeast-2`에 배포를 준비합니다. 아래 명령은 change set까지만 만들며 리소스 생성은 별도 실행 단계입니다.

```powershell
sam deploy --template-file infra/concierge.yaml --stack-name pulda-concierge --profile <your-profile> --region ap-southeast-2 --resolve-s3 --capabilities CAPABILITY_IAM --no-execute-changeset --parameter-overrides ExistingApiHost=<현재-진료-API-호스트> SecretArn=<기존-JSON-secret-ARN> OperatorName=<운영자> PrivacyEmail=<이메일>
```

최초 `AppOrigin=https://bootstrap.invalid`에서는 API 사용이 차단됩니다. 생성 결과 `Website`로 `AppOrigin`을 업데이트하고 기존 진료 서버의 `APP_ORIGIN`도 같은 값으로 바꾼 뒤 공개해야 합니다. 두 서버는 같은 `SESSION_SECRET`을 사용합니다. 접근 코드가 있는 운영 환경에서는 Secret의 `PULDA_ACCESS_CODE`도 같게 두고 `EnableAccessCode=true`로 배포합니다. CloudFront는 API의 쿠키·CSRF·Origin 헤더를 전달하며 응답을 캐시하지 않습니다. 해시 라우터를 사용하므로 API 오류를 index.html로 치환하는 SPA 오류 페이지 규칙은 넣지 않습니다.

프론트는 `npm run build` 결과 `dist/`를 출력된 `WebBucket`에 올립니다. 해시 파일은 긴 캐시, `index.html`은 `Cache-Control: no-cache`로 업로드하고 변경 시 CloudFront의 `/index.html`과 `/`를 무효화합니다. 실제 전사·접수 SSE·쿠키·접근 코드 흐름은 이 새 HTTPS origin에서 별도 검증한 뒤 전환하세요. 템플릿의 경보에는 기본 알림 수신자가 없습니다.

### 비용과 연락 채널

Lambda 동시성은 6, 검색 작업자 동시성은 2, 세션당 검색은 시간당 12회, 기본 전역 검색 한도는 UTC 일당 100회입니다. 웹 검색과 GPT 호출, AgentCore Memory, S3/CloudFront, API Gateway, SQS, DynamoDB 및 정리용 Scan에는 사용량 요금이 발생할 수 있습니다. 프리티어·크레딧 적용 여부는 계정과 서비스별로 확인하며 무료 운영을 보장하지 않습니다. 횟수 제한은 정확한 통화 금액 상한이 아닙니다.

한국의 AWS End User Messaging SMS는 국가 지원표에서 양방향 SMS를 지원하지 않으므로 자동 문자 왕복을 구현한 것으로 표시하지 않습니다. 향후 서버가 직접 문의하려면 국내 발신번호·회신 수신이 가능한 사업자 또는 상담 운영 채널과 발송/회신 webhook, 중복 발송 방지, 상태 조회를 추가해야 합니다. 지금은 확인된 공개 문자 번호 또는 사용자가 직접 확인한 번호로 기기의 문자 앱을 엽니다.

근거: [OpenAI Agents 도구](https://openai.github.io/openai-agents-js/guides/tools/), [AgentCore Memory 리소스](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-bedrockagentcore-memory.html), [AWS 국가별 SMS 지원](https://docs.aws.amazon.com/sms-voice/latest/userguide/phone-numbers-sms-by-country.html).

---

현재 서비스 주소: https://pu-47f72605b46140b3aa470e8dd3c40a31.ecs.ap-southeast-2.on.aws

스택: `pulda-service`, 리전: `ap-southeast-2`, 배포 이미지 태그: `release-20261009-r2`. 최종 이미지 digest는 `sha256:71fe3b44a19947c9aca83ecbde2e48499e58d521f342081232fead439f94d64a`입니다. 2026-10-09 ECR 플랫폼 이미지 검사 결과 발견 항목 0건입니다. 초기 검사에서 제외된 `af48cac`, `release-20261009` 이미지는 운영 복구에 사용하지 마세요.

2026-10-09 공개 HTTPS 화면 200, 실제 분석 API의 출처 검증, Origin/CSRF 차단, 실시간 전사 WebSocket의 연결·종료를 합성 자료로 확인했습니다. 실제 기기 마이크와 진료 음성 품질 검증은 별도입니다.

## 도메인 없는 배포: ECS Express Mode

`aws-express.yaml`은 AWS가 관리하는 HTTPS 주소와 인증서를 제공합니다. 사용자 도메인이 없으므로 이번 배포는 이 구성을 사용합니다. 기존 `aws.yaml`은 자체 도메인·ACM 인증서·private subnet이 준비된 경우의 대안으로 유지합니다.

- 선택 리전 `ap-southeast-2`, CLI 프로필은 `AWS_PROFILE` 또는 `--profile`로 지정. 기존 기본 VPC의 public subnet을 사용합니다. 태스크에 public IP가 있지만 inbound는 Express Mode가 생성한 ALB 보안 그룹에서만 허용합니다. 이 조건을 배포 후 확인해야 합니다.
- 태스크당 0.25 vCPU / 512 MiB, 최소 2개·최대 4개, CPU 60% 자동 확장. NAT Gateway는 만들지 않습니다. ALB·태스크·public IPv4·WAF 등은 사용 요금이 발생하며 무료 플랜 크레딧을 소비합니다.
- 읽기 전용 루트, UID 1000, Linux capability 제거, 건강 상태 검사, 30일 로그 보관. 실행 역할은 지정한 Secret만 읽고, 앱 역할은 사용량 테이블의 UpdateItem만 허용합니다.
- 최초에는 `AppOrigin=https://bootstrap.invalid`로 생성하여 API 요청을 차단합니다. 생성 결과 `Endpoint`를 읽은 뒤 그 정확한 HTTPS origin으로 CloudFormation을 업데이트합니다. 호스트 이름에서 임의로 origin을 신뢰하지 않습니다.
- Express Mode의 canary 배포와 deployment circuit breaker, WAF IP 요청 제한을 사용합니다. 개인정보를 포함할 수 있는 sampled requests와 body/access 로그는 켜지 않습니다. 이메일 알림 수신자는 별도 연결하지 않았습니다.
- 새 AWS 프로젝트에서는 `AWSServiceRoleForECS`가 처음 만들어진 뒤 권한 전파를 기다려야 합니다. 또한 확인된 AWS Express 인프라 관리 정책 v6에는 `ecs:DescribeServices`, `ecs:UpdateService`가 없어 초기 provisioning이 거절됐습니다. 템플릿은 이 두 작업을 **생성한 클러스터의 pulda 서비스 ARN 한 개**에만 추가합니다. 사용자 권한은 확장하지 않습니다.

배포 도구는 `scripts/aws-release.py`입니다. Python 가상 환경에서 `pip install -r infra/requirements.txt`로 준비합니다. AWS CLI가 PATH에 없으면 `AWS_CLI` 환경 변수에 실행 파일 경로를 지정하세요. 도구는 로그인된 CLI의 단기 자격 증명을 메모리로 받아 SDK에 전달합니다. `secret`은 기존 Secret을 덮어쓰지 않으며, `push`는 임시 ECR 인증 파일을 사용 후 제거합니다.

```powershell
python scripts/aws-release.py secret
docker build --platform linux/amd64 -t pulda:<release> .
python scripts/aws-release.py push --image pulda:<release> --tag <release>
# params.json: PublicSubnets, ImageUri(digest), SecretArn, AppOrigin, OperatorName, PrivacyEmail
python scripts/aws-release.py plan --parameters tmp/params.json --change-set <release> --change-type CREATE
# 변경 목록을 검토한 뒤 AWS CLI execute-change-set으로 실행합니다.
# 이후 배포와 origin 확정은 --change-type UPDATE를 사용합니다.
```

릴리스 전에 ECR의 **플랫폼 이미지 digest** 검사 결과를 확인하세요. OCI image index 자체는 스캔 대상이 아닙니다. 높은 심각도 항목을 검토하지 않은 이미지를 운영에 적용하지 마세요. 런타임 기반 이미지는 Dockerfile에서 digest로 고정했습니다. 업데이트 시 새 digest를 빌드·검사·검증하여 교체합니다.

배포 뒤 `SMOKE_ORIGIN`과 `APP_ORIGIN`을 실제 HTTPS origin으로 설정하고 `node scripts/smoke-api.mjs`, `node scripts/smoke-voice.mjs tmp/synthetic-voice.wav`를 실행할 수 있습니다. 합성 데이터만 사용하며 실제 OpenAI 사용료가 발생합니다.

상태 확인: `python scripts/aws-status.py`. ALB에는 idle timeout 120초, 잘못된 HTTP 헤더 차단, defensive desync mitigation을 적용했습니다. 이 값은 Express Mode 템플릿 밖의 ALB 속성이므로 로드밸런서가 재생성되면 다시 확인하세요. 초기 target group은 건강 검사 10초 간격·2회 성공으로 설정했습니다.

## 자체 도메인을 사용하는 구성

`aws.yaml`은 기존 VPC에 HTTPS ALB, private ECS Fargate 태스크 2개, DynamoDB 사용량 제한 테이블, Secrets Manager 읽기 권한, CloudWatch 로그, WAF 요청 제한을 만듭니다. 진료 데이터베이스나 음성 저장소는 만들지 않습니다. 이 템플릿의 작성·정적 검증과 실제 계정 배포는 별개입니다.

## 필요한 값

- AWS CLI v2 로그인과 Docker Linux 엔진. 본인 AWS 프로필을 지정하고, 선택 리전은 `ap-southeast-2`입니다. AWS Settings → View all projects → Overview → Additional Info → Region에서 확인하세요. 이 프로젝트의 다른 리전에 리소스를 만들지 마세요.
- 새 AWS 경험의 무료/유료 플랜과 지원 서비스를 먼저 확인하세요. `aws --profile <your-profile> --region us-east-1 freetier get-account-plan-state`는 전역 플랜 상태 조회용이며 프로젝트 리소스 생성 리전과 다릅니다. AWS Settings → Billing에서 현재 잔액과 지출 한도를 확인하세요.
- 서로 다른 AZ의 ALB용 public subnet 2개, ECS용 private subnet 2개. private subnet에서 OpenAI 인터넷 접속과 AWS API/ECR 접근을 위한 NAT 경로가 필요합니다.
- 앱 도메인과 같은 리전의 ACM 인증서. `AppOrigin`은 `https://도메인` 형식이고 끝에 `/`를 붙이지 않습니다.
- ECR 저장소의 immutable image digest. 태그만으로는 배포할 수 없도록 제한했습니다.
- Secrets Manager JSON secret: `OPENAI_API_KEY`, 32자 이상 무작위 `SESSION_SECRET`. 모든 태스크가 같은 세션 비밀 값을 사용합니다. 기본 AWS 관리 암호화 키를 가정합니다. 고객 관리 KMS 키를 쓰면 execution role에 해당 키의 `kms:Decrypt` 권한을 추가하세요.
- 운영자명 `OperatorName`, 개인정보 문의 이메일 `PrivacyEmail`. 설정되지 않은 production 서버는 실행을 거부합니다.

키를 `VITE_*`, 이미지 빌드 인자, GitHub 파일이나 CloudFormation 평문 파라미터로 전달하지 마세요. `.dockerignore`는 허용한 소스만 전송하며 `.env`를 제외합니다.

## 검증과 배포 순서

```powershell
npm ci
npm test
npm run build
npm audit
cfn-lint infra/aws.yaml
docker build --platform linux/amd64 -t pulda:release .
```

ECR로 이미지를 push하고 그 digest를 확인한 후, 아래 파라미터를 채워 CloudFormation change set을 검토합니다. CLI 명령에는 비밀 값 대신 Secret ARN만 전달합니다. ALB·Fargate·NAT·WAF에는 AWS 사용 요금이 발생합니다.

```powershell
aws cloudformation deploy --profile <your-profile> --region ap-southeast-2 --stack-name pulda-service --template-file infra/aws.yaml --capabilities CAPABILITY_IAM --no-execute-changeset --parameter-overrides VpcId=<vpc-id> PublicSubnets=<subnet-a,subnet-b> PrivateSubnets=<subnet-c,subnet-d> CertificateArn=<certificate-arn> AppOrigin=<https-origin> ImageUri=<ecr-uri@sha256:digest> SecretArn=<secret-arn> OperatorName=<operator> PrivacyEmail=<email>
```

Change set의 리소스와 비용을 확인하고 실행하세요. 출력된 ALB DNS 이름을 앱 도메인의 DNS alias/CNAME으로 연결합니다. `/readyz`가 200인지 확인한 뒤 HTTPS 도메인에서 실제 기기 마이크·권한 거절·일시정지·다시 연결·마지막 자막·사진 읽기·출처·보관과 삭제를 확인합니다. 이 자체 도메인 구성은 현재 배포에 사용하지 않았습니다.

## 운영과 복구

- API는 같은 origin만 허용합니다. ALB만 태스크 3001 포트에 접근할 수 있도록 보안 그룹을 유지하세요. 서버의 `trust proxy=1`은 이 구성을 전제로 합니다.
- 익명 세션은 60분, 전사 연결은 한 번에 최대 15분입니다. 종료되면 명시적으로 다시 시작합니다. 연결 복구 시 이전 음성을 재전송하지 않습니다. 자막 일부를 놓쳤다면 글로 다시 확인하세요.
- 글로벌 기본 한도: AI 요청 1,000회/UTC일, 전사 연결 200회/UTC일. 문장 다듬기는 생성·검토 2회를 소비합니다. 세션당 AI 20회/시간, 전사 연결 20회/시간, IP당 세션 발급 30회/시간입니다. 방문자에 맞춰 한도를 낮추거나 높이세요. 요청 횟수 제한은 통화 금액의 정확한 상한이 아니므로 OpenAI 프로젝트 예산과 AWS Budgets도 설정하세요.
- DynamoDB는 모든 태스크에서 원자적으로 한도를 적용하며 장애 시 유료 기능을 차단합니다. TTL은 만료 표시 후 AWS가 비동기로 삭제하므로 정확한 삭제 시각을 보장하지 않습니다. 여기에는 해시 식별자와 카운터만 있으며 진료 내용은 없습니다.
- WAF sampled requests를 끄고, 애플리케이션 로그에 요청 본문·쿠키·키·음성·진료 글을 남기지 않습니다. APM, 프록시 body 로그, 외부 분석 도구를 추가할 때도 이 정책을 유지하세요.
- 앱은 음성을 디스크에 기록하지 않습니다. OpenAI의 기본 오용 방지 보관과 풀다 서버의 보관 정책은 다릅니다. `store:false`는 Responses 저장을 끄며 계정의 Zero Data Retention 승인을 대신하지 않습니다.
- Secret 회전 후 ECS 새 배포가 필요합니다. session secret 회전은 기존 세션을 만료시킵니다. OpenAI 키 폐기는 공급자 콘솔에서 별도로 실행합니다.
- 배포 실패는 ECS circuit breaker가 rollback합니다. 기능 문제가 있으면 이전에 검증한 ImageUri digest로 stack을 업데이트합니다. 건강 정보가 없는 health/status 메트릭으로 5xx·불건전 태스크·비용을 관찰하세요.
- ALB 5xx/UnHealthyHostCount, ECS CPU/Memory, DynamoDB throttling과 OpenAI 429에 대한 운영 알림 수신자는 운영 계정에서 지정해야 합니다. 실제 부하 시험과 장애 복구 훈련을 수행한 뒤 서비스 트래픽을 늘리세요.

공식 근거: [ECS Secrets Manager 주입](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html), [ALB listeners와 WebSocket](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-listeners.html), [OpenAI 데이터 처리](https://developers.openai.com/api/docs/guides/your-data).
