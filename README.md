# DHO Catalog

DHO Navigator 앱의 Catalog 창이 읽는 공개 Module·리소스팩 목록 저장소입니다.

- 앱은 이 저장소 Release의 `catalog.json` 하나를 받아 목록을 그립니다.
- 각 항목의 파일은 제작자 저장소의 GitHub Release에서 받습니다. 받은 파일은 등재 때 기록한 크기·SHA-256과 같을 때만 설치 화면으로 넘어갑니다.
- 설치·업데이트·권한 동의는 Navigator의 기존 설치 화면이 맡습니다. Catalog는 받고 확인하는 일만 합니다.
- 등재는 배포자 인증이 아닙니다. 등재된 항목도 앱에서 `미검증 배포자`로 표시됩니다.

## 저장소 구조

```text
items/
  modules/<moduleId>/      Module 하나
    item.json              등재 정보(등재자 작성, 고정 값은 등재 workflow가 기록)
    thumbnail.png|webp     선택
    screenshots/1~4.png|webp|jpg  선택, 최대 4장
    README.md              필수, 소개 본문
    CHANGES.md             선택, 변경 내역
  packs/<packId>/          리소스팩 하나(같은 구조)
schema/
  item-v1.schema.json      item.json 형식
  catalog-v1.schema.json   catalog.json 형식
catalog-base.json          목록 수준 값(schemaVersion, minimumManagerVersion, withdrawn)
tools.lock.json            등재 검사에 쓰는 공개 도구 키트 버전·SHA-256과 고급 권한 목록
scripts/                   검사·등재·목록 생성 스크립트(Node.js 20.11.1 이상, 외부 의존성 없음)
test/                      node --test 검사
.github/workflows/
  pr-lint.yml              PR 안내용 검사
  register.yml             소유자 승인 등재
  publish.yml              목록 생성과 Release
```

## 등재 신청

등재 신청은 이 저장소에 PR을 보내는 것입니다. PR 하나는 `items/modules/<moduleId>/` 또는 `items/packs/<packId>/`
폴더 하나만 바꿀 수 있습니다.

### 준비

- 공개 GitHub 저장소에서 GitHub Release로 배포합니다.
- 받는 주소는 `https://github.com/<owner>/<repo>/releases/download/<tag>/<이름>-<버전>.dho-module`(팩은 `.dho-pack`)
  형식이어야 합니다.
  - 태그로 `latest`는 쓸 수 없습니다.
  - 파일 이름은 소문자·숫자·`-`로 된 이름 뒤에 `-<버전>`과 확장자를 붙입니다. 예: `logbook-1.0.1.dho-module`
  - query, fragment, 포트, percent-encoding은 쓸 수 없습니다.
- Release는 공개 상태여야 하고 draft·prerelease가 아니어야 합니다.
- 같은 Release에 `<파일 이름>.sha256` 파일을 함께 올리기를 권장합니다. 있으면 값이 맞는지 확인하고, 없으면 경고만 합니다.
- 버전은 semver(`1.2.3`)입니다. 팩도 `version`을 semver로 씁니다.
- 공개 도구로 검사를 통과한 파일이어야 합니다.
  - Module: `dho-module-node-tools.zip`의 `node tools/verify-module.mjs <파일>`
  - 팩: `dho-pack-node-tools.zip`의 `node tools/verify-archive.mjs <파일>`
  - 등재 검사는 `tools.lock.json`에 고정한 키트 버전으로 합니다.

### `item.json`

등재자는 표시 정보와 Release 주소만 적습니다. 파일 해시는 적지 않습니다.

```json
{
  "kind": "module",
  "id": "dev.example.sample-tool",
  "name": "Sample",
  "summary": "80자 이하의 짧은 설명",
  "publisher": { "id": "dev.example", "name": "Example" },
  "repository": "example-owner/sample-tool",
  "license": "MIT",
  "advanced": null,
  "versions": [
    {
      "version": "1.0.0",
      "releasedAt": "2026-11-17T00:00:00Z",
      "compatibility": { "minimumManagerVersion": "2.2.0" },
      "capabilities": ["navigation.read", "storage.local"],
      "download": {
        "url": "https://github.com/example-owner/sample-tool/releases/download/v1.0.0/sample-1.0.0.dho-module",
        "fileName": "sample-1.0.0.dho-module"
      }
    }
  ]
}
```

| 필드 | 규칙 |
| --- | --- |
| `kind` | `module` 또는 `pack`. 폴더(`modules/`·`packs/`)와 같아야 합니다 |
| `id` | archive의 `moduleId`·`packId`. 폴더 이름과 같아야 합니다. `app.dhoport.manager.`로 시작하는 Module ID와 `builtin.`으로 시작하는 팩 ID는 쓸 수 없습니다 |
| `name` | 1~40자 |
| `summary` | 1~80자 짧은 설명 |
| `publisher` | `id`는 archive의 `publisher.id`와 같아야 합니다. `name` 1~40자, `url`은 선택이며 https만 |
| `repository` | `owner/repo`. 받는 주소의 저장소와 같아야 합니다. 한 번 등재되면 바꿀 수 없습니다(소유자 확인 필요) |
| `license` | 1~64자. SPDX 식별자를 권장합니다 |
| `advanced` | 고급 권한을 쓰는 버전이 하나라도 있으면 `{ "explanation": "1~300자" }`, 없으면 `null` |
| `versions` | 1~5개, semver 내림차순. 앱은 호환되는 가장 높은 버전 하나를 제시합니다 |
| `versions[].compatibility` | archive의 `minimumManagerVersion`·`maximumManagerVersionExclusive`와 같아야 합니다(없으면 생략) |
| `versions[].capabilities` | Module은 archive manifest의 capability 전체를 정렬해 적습니다. 팩은 `[]` |
| `versions[].download` | `url`과 `fileName`만 적습니다. `bytes`·`sha256`은 등재 workflow가 기록합니다 |

### 고급 권한 설명

다음 capability 중 하나라도 쓰면 `advanced.explanation`이 필수입니다. 앱의 Catalog 상세 화면은 앱이 정한 경고 문구 아래에
이 설명을 `제작자 설명`으로 함께 보여 줍니다. 무엇을 왜 쓰는지, 무엇을 하지 않는지를 구체적으로 적어 주세요.

- `network.session`, `network.stream`
- `sidecar.execute`, `sidecar.resident`
- `vision.captureRegion`, `vision.readText`
- `files.user`
- `service.background`

### 소개 폴더

| 파일 | 규칙 |
| --- | --- |
| `README.md` | 필수, 64 KiB 이하 UTF-8. 앱은 제한 Markdown만 그립니다(원문 HTML·본문 이미지·각주·체크박스는 표시하지 않음). 링크는 `https://` 절대 주소만 쓸 수 있습니다 |
| `CHANGES.md` | 선택, 32 KiB 이하. 같은 Markdown 규칙 |
| `thumbnail.png` 또는 `thumbnail.webp` | 선택, 512 KiB·1024×1024 이하 |
| `screenshots/1.png` … `4.*` | 선택, png·webp·jpg, 장당 1 MiB·2560×1600 이하, 1번부터 빈틈없이 |

그 밖의 파일은 둘 수 없습니다. 파일 이름의 대소문자도 위와 같아야 합니다.

### 등재 기준

- 공개 저장소의 공개 Release에서 받는 파일입니다.
- 고정한 공개 도구 검사를 통과합니다.
- archive의 ID·버전·배포자 ID·호환 범위·capability 전체가 `item.json`과 같습니다.
- 고급 권한을 쓰면 설명이 있습니다.
- 팩은 `formatVersion` 1이고, `signature` 선언이 없고, 버전이 semver입니다.
- 내장 거점 좌표 보정·숨김(`poiData`의 `coordinateOverrides`·`hiddenPoiIds`)이 든 팩은 등재하지 않습니다.
  내장 거점 좌표 오류는 DHO PORT 도시 도감에서 고칩니다. 새 거점 추가(`pois`)는 등재할 수 있습니다.
- 소개 폴더가 위 규칙을 지킵니다.

PR을 열면 `pr-lint`가 형식을 안내합니다. 이 결과는 참고용이며 등재 판정은 아래 소유자 승인 흐름이 합니다.

### 새 버전 올리기

- 같은 폴더의 `versions` 맨 앞에 새 버전을 더하는 PR을 보냅니다.
- 이미 등재된 버전의 `download`·`compatibility`·`capabilities`는 바꿀 수 없습니다.
- 오래된 버전은 빼도 됩니다(최대 5개).
- 새 버전 없이 소개 정보(`name`·`summary`·`advanced` 등)나 소개 폴더만 바꾸는 PR도 같은 승인 흐름으로 반영합니다.

## 소유자 승인 흐름

1. 소유자가 PR의 표시 정보·설명·소개 자료를 읽습니다.
2. 소유자가 Actions에서 `register`를 PR 번호와 검토한 head commit으로 실행합니다.
3. 검사 job이 main의 코드로 실행됩니다. PR commit은 데이터로만 읽고, PR의 workflow·스크립트는 실행하지 않습니다.
   - 새 버전마다 Release 파일을 한 번 받아, 같은 byte로 공개 도구 검사·manifest 대조·크기와 SHA-256 계산을 합니다.
   - 결과(버전·크기·SHA-256·capability)를 실행 요약에 표로 냅니다.
   - main 대비 추가·제거되는 버전, 바뀌는 `item.json` 필드와 파일, PR 작성자와 `repository` owner를 함께 냅니다.
     둘이 다르면 경고합니다.
   - PR이 갈라진 뒤 main의 같은 항목 폴더가 바뀌었으면(예: 그 사이 새 버전 등재) 거부합니다. 등재자는 최신 main으로
     rebase한 뒤 다시 신청합니다. commit job도 최신 main 기준으로 같은 검사를 다시 합니다.
4. 소유자가 요약을 확인하고 `catalog-register` 환경을 승인합니다. 이 승인이 고정 승인입니다.
5. commit job이 검사 결과를 다시 검증하고 같은 주소를 한 번 더 받아 일치를 확인한 뒤, PR의 항목 폴더와 고정 값을
   main에 commit합니다. PR은 그 commit 링크와 함께 닫힙니다.
6. main이 바뀌면 `publish`가 `catalog.json`을 만들어 `catalog-r<번호>` Release로 냅니다.

등재 뒤 제작자가 같은 태그의 파일을 바꾸면 해시가 달라 앱이 설치하지 않습니다. 다시 내려면 새 버전으로 등재합니다.

`withdrawn`(내려간 항목), `schema/`, `tools.lock.json`, workflow 변경은 소유자의 관리자 PR로만 합니다.

## 목록 생성

- `publish`는 `items/`나 `catalog-base.json`이 바뀐 main push마다 한 번 실행되고, 한 번에 하나만 돕니다.
- `catalogRevision`은 이미 있는 `catalog-r*` 태그 중 가장 큰 번호 + 1입니다. 그 태그가 이미 있으면 Release를 만들지 않고 실패합니다.
- `item.json`의 고정 값을 그대로 옮깁니다. 파일을 다시 받거나 해시를 다시 계산하지 않습니다.
- 고정 값이 없는 버전이 하나라도 있으면 실패합니다.
- 소개 자료의 크기·SHA-256은 생성 때 계산하고, 앱은 `sourceCommit`으로 고정한 주소에서만 받습니다.
- 등재된 항목과 `withdrawn`이 모두 비어 있으면 Release를 만들지 않습니다.

## 저장소 설정(소유자 할 일)

workflow가 의도대로 동작하려면 GitHub 설정에서 다음을 해야 합니다. 값과 이름 중 `<...>`는 소유자가 정합니다.

1. Actions 일반 설정
   - Workflow permissions: `Read repository contents and packages permissions`(기본 읽기 전용).
   - Fork pull request workflows from outside collaborators: `Require approval for all outside collaborators`.
   - `Allow GitHub Actions to create and approve pull requests`: 끔.
   - 이 저장소에는 자체 호스팅 runner를 등록하지 않습니다. 모든 workflow는 `ubuntu-latest`만 씁니다.
2. 저장소 쓰기 권한자는 소유자 한 명으로 둡니다(다른 사람은 PR만 보냅니다).
3. 등재 전용 GitHub App
   - 조직에 App `<dho-catalog-register>`를 만들고 이 저장소에만 설치합니다.
   - Repository permissions: Contents `Read and write`, Pull requests `Read and write`, Metadata `Read`.
   - `Workflows` 권한은 주지 않습니다. App 키가 새어도 workflow 파일은 바꿀 수 없게 하기 위해서입니다.
   - 저장소 변수 `CATALOG_APP_CLIENT_ID`에 App Client ID를 넣습니다.
4. Environment `catalog-register`
   - Required reviewers: 소유자.
   - Prevent self-review: 끔(켜면 실행한 소유자가 승인할 수 없어 멈춥니다).
   - Deployment branches: `main`만.
   - Environment secret `CATALOG_APP_PRIVATE_KEY`에 App 개인키를 넣습니다. 저장소·조직 secret에는 두지 않습니다.
5. main ruleset
   - Restrict deletions, Block force pushes, Require a pull request before merging.
   - Bypass list: 소유자와 위 App만.
   - classic branch protection은 쓰지 않습니다.
6. 태그 ruleset `catalog-r*`
   - Restrict updates, Restrict deletions, Block force pushes. 생성은 막지 않습니다(`publish`가 만듭니다).
   - 목록 태그를 지우면 같은 번호가 다른 내용으로 다시 만들어질 수 있어 앱이 그 목록을 거부합니다.
7. Code owners
   - `.github/CODEOWNERS`가 workflow·schema·scripts·`tools.lock.json`·`catalog-base.json`·`items/`를 소유자로 지정합니다.
   - ruleset에서 `Require review from Code Owners`를 켭니다.
8. Immutable releases(검토)
   - 켜면 publish된 `catalog-r*` Release의 `catalog.json`을 나중에 바꿀 수 없습니다. 제작자 저장소에 강제하는 설정이 아니라 이 저장소에만 쓰는 설정입니다.
   - 켜기 전에 `publish`의 `gh release create <태그> catalog.json`(자산을 붙여 바로 공개)이 그대로 동작하는지 확인합니다.
     1. 이 저장소를 fork하거나 시험용 저장소를 만들어 Immutable releases를 켭니다.
     2. 시험 태그로 `gh release create catalog-r999999 catalog.json --latest --notes test`를 실행합니다.
     3. Release가 만들어지고 자산이 붙었는지, 그 뒤 `gh release upload --clobber`로 자산 교체가 거부되는지 확인합니다.
     4. 시험 Release와 태그는 시험 저장소에서만 만들고 지웁니다(이 저장소의 `catalog-r*` 번호를 쓰지 않습니다).
   - 자산을 붙이는 단계가 거부되면 켜지 않고, 이 저장소의 태그 ruleset으로 대신합니다.

## 로컬 검사

```sh
node --test
node scripts/lint-items.mjs
```

## 알려진 제한

- 목록에는 서명이 없습니다. 이 저장소·소유자 계정이 탈취되면 목록을 바꿀 수 있습니다. 앱의 설치 검사와 사용자 동의는 그대로 적용됩니다.
- 제작자가 Release 파일을 지우면 그 항목은 설치할 수 없습니다. 이 저장소는 파일을 따로 보관하지 않습니다.
- 고급 권한 목록의 원본은 공개 Module 정책의 `advancedCapabilities`입니다. 그 필드가 든 도구 키트가 나오기 전까지는
  `tools.lock.json`의 같은 목록을 쓰고, 키트에 필드가 생기면 두 목록이 같은지 등재 때 확인합니다.
