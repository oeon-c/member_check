# 동아리 정산

휴대폰에서 학기별 명단, 이벤트 참여자, 1인당 납부액과 입금 공지를 관리하는 총무용 웹앱.

## 실행과 배포

- 로컬에서는 프로젝트 폴더에서 `python -m http.server 8000`을 실행하고 `http://localhost:8000/`을 연다. 설정이 비어 있으면 체험판 데이터는 해당 브라우저에만 저장된다.
- GitHub에서 새 저장소를 만들고 이 소스의 `main` 브랜치를 푸시한다. 저장소의 **Settings → Pages → Source → GitHub Actions**를 선택한 뒤 **Actions → Deploy GitHub Pages → Run workflow**를 실행한다. 이후 main 푸시로 자동 배포된다.
- Supabase 프로젝트의 SQL Editor에서 `schema.sql`을 한 번 실행한다. `config.js`에는 프로젝트 URL과 **publishable key**를 넣는다. 개인 명단과 계좌 정보는 앱 화면에서 입력한다. 카카오 시크릿과 Supabase secret/service_role 키는 서버 설정에서만 사용한다.
- [Supabase 카카오 로그인 가이드](https://supabase.com/docs/guides/auth/social-sign-in/auth-kakao)에 따라 카카오 개발자 앱을 만들고 Supabase에 카카오 인증을 설정한다. Supabase의 Kakao callback URL을 카카오에 등록하고, GitHub Pages 앱 주소를 Supabase의 Site URL 및 Redirect URLs에 등록한다. 인수인계 링크를 사용하려면 같은 앱 주소 경로의 `?handover=...` 변형도 허용한다.
- 첫 총무가 배포 앱에서 카카오 로그인한 뒤 Supabase Authentication → Users에서 자신의 사용자 UUID를 확인한다. SQL Editor에서 아래 문장의 UUID를 바꿔 한 번 실행한 후 웹앱을 새로고침한다.

```sql
insert into public.club_workspace (owner_id) values ('첫-총무-사용자-UUID');
```

## 인수인계

현 총무가 설정에서 만든 링크를 후임에게 직접 전달한다. 누구든 링크와 로그인 계정을 갖고 있으면 수락할 수 있으므로 후임에게만 전달한다. 새 링크를 발급하면 이전 링크는 폐기된다. 링크는 24시간 동안 유효하고 한 번만 사용할 수 있다. 후임이 수락하면 서버의 관리 권한이 즉시 이전되고 후임은 자신의 입금 정보를 새로 입력한다.

앱에서 이전되는 권한은 명단과 정산 운영 권한이다. GitHub와 Supabase 프로젝트 자체의 관리 권한도 후임에게 맡기려면 해당 서비스에서 관리자 권한을 별도로 정리한다.
