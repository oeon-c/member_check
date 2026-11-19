# 동아리 정산

휴대폰에서 학기별 명단, 행사와 정산 체크용 항목의 참여자, 1인당 납부액, 입금 현황과 공지를 관리하는 총무용 웹앱. 기존 이벤트는 `행사`로 분류하며 시행일을 입력한다. `정산 체크용`은 시행일 없이 입금 마감일과 시간을 기준으로 등록한다. 정산 화면에서는 인당 납부액을 입력하며 총 납부액은 인당 금액에 인원을 곱해 표시한다. 항목 수정은 한 화면에서 모두 입력한 뒤 하단의 저장 버튼으로 한 번에 반영한다. 입금 확인은 항목 화면의 팝업에서 처리하고, 완료된 입금자는 확인 목록의 아래쪽에 표시된다. 공지 템플릿의 `{{참여자명단}}`은 선택된 참여자 이름을 쉼표로 구분해 한 줄로 채우며, `{{인당비용}}`에는 계산된 1인당 납부액이 들어간다. 설정 정보는 조회 화면과 수정 화면으로 나뉘고, 저장 후에는 결과 화면으로 이동하며 완료 팝업이 표시된다.

## 실행과 배포

- 로컬에서는 프로젝트 폴더에서 `python -m http.server 8000`을 실행하고 `http://localhost:8000/`을 연다. 설정이 비어 있으면 체험판 데이터는 해당 브라우저에만 저장된다.
- GitHub 저장소의 **Settings → Pages → Build and deployment → Source**에서 **GitHub Actions**를 선택한다. 이 저장소의 workflow는 `main` 푸시와 수동 실행을 지원하며, Pages 아티팩트를 빌드해 배포한다.
- GitHub 저장소의 **Settings → Secrets and variables → Actions → Variables**에 `SUPABASE_URL`과 `SUPABASE_PUBLISHABLE_KEY`를 추가한다. 둘 다 브라우저에 공개되는 프로젝트 URL과 publishable key다. workflow가 두 변수를 배포용 `config.js`에 넣는다. 값이 비어 있으면 브라우저 로컬 저장 체험판으로 실행된다. `config.js` 원본은 로컬 체험판에서 빈 값으로 둔다.
- Supabase 프로젝트의 SQL Editor에서 `schema.sql`을 한 번 실행한다. [Supabase 카카오 로그인 가이드](https://supabase.com/docs/guides/auth/social-sign-in/auth-kakao)에 따라 Kakao Developers 앱의 플랫폼에 기본 GitHub Pages 도메인 `https://oeon-c.github.io`를 등록하고, Kakao Login Redirect URI에는 Supabase가 표시하는 callback URL(`https://<project-ref>.supabase.co/auth/v1/callback`)을 등록한다. Kakao의 REST API key와 로그인 Client Secret은 Supabase Authentication의 Kakao provider 설정에 입력한다. 카카오 동의항목에서 이메일을 제공하지 않으면 Supabase의 해당 provider 설정에서 이메일 없이 로그인 허용을 켠다.
- Supabase **Authentication → URL Configuration**의 Site URL을 `https://oeon-c.github.io/member_check/`로 지정하고, Redirect URLs에도 해당 주소를 추가한다. 사용자 정의 도메인을 쓰면 위 두 URL을 실제 배포 주소로 바꾼다. 인수인계 링크는 같은 경로에 `?handover=...`를 붙인다.
- 개인 명단과 계좌 정보는 앱 화면에서 입력한다. Kakao Client Secret, Supabase secret/service_role 키는 GitHub 변수나 정적 파일에 넣지 않는다.
- 첫 총무가 배포 앱에서 카카오 로그인한 뒤 Supabase Authentication → Users에서 자신의 사용자 UUID를 확인한다. SQL Editor에서 아래 문장의 UUID를 바꿔 한 번 실행한 후 웹앱을 새로고침한다.

```sql
insert into public.club_workspace (owner_id) values ('첫-총무-사용자-UUID');
```

## 인수인계

현 총무가 설정에서 만든 링크를 후임에게 직접 전달한다. 누구든 링크와 로그인 계정을 갖고 있으면 수락할 수 있으므로 후임에게만 전달한다. 새 링크를 발급하면 이전 링크는 폐기된다. 링크는 24시간 동안 유효하고 한 번만 사용할 수 있다. 후임이 수락하면 서버의 관리 권한이 즉시 이전되고 후임은 자신의 입금 정보를 새로 입력한다.

앱에서 이전되는 권한은 명단과 정산 운영 권한이다. GitHub와 Supabase 프로젝트 자체의 관리 권한도 후임에게 맡기려면 해당 서비스에서 관리자 권한을 별도로 정리한다.
