# Herald

해역·계절 알림 Module입니다. 배가 새 해역에 들어서면 게임 화면 위쪽에 해역 이름을 크게 띄우고 은은한 진입음을 냅니다.
여름·겨울 계절이 바뀔 때도 알립니다.

- 제목은 해역 이름, 부제는 상위 바다 이름입니다(예: 비스케이만 / 북해).
- 진입음은 상위 바다를 묶은 9개 묶음마다 분위기에 맞는 소리가 기본으로 정해져 있습니다.
- 소리는 묶음, 상위 바다, 해역 단위로 바꿀 수 있고 직접 가져온 소리 파일도 쓸 수 있습니다.
- HUD 전용입니다. HUD가 꺼져 있거나 게임 창이 최소화되면 배너도 소리도 나지 않습니다.
- HUD를 켠 직후의 첫 해역은 알리지 않습니다.

## 권한

| 권한 | 쓰는 곳 |
| --- | --- |
| `navigation.read` | 해역·계절 변경 이벤트와 해역 목록 읽기 |
| `notifications.show` | 게임 화면 배너 알림 |
| `audio.play` | 진입음·계절음 재생 |
| `storage.local` | 설정 저장 |
| `files.user` | 내 소리 파일 가져오기·지우기 |

## 설정

Module 관리에서 이 Module의 설정 창을 엽니다.

| 항목 | 내용 |
| --- | --- |
| 해역 진입 알림 | 해역 알림 전체를 켜고 끕니다. |
| 알림 시점 | 기본은 "배너는 해역마다, 소리는 상위 바다가 바뀔 때만"입니다. "해역마다 배너와 소리", "상위 바다가 바뀔 때만 배너와 소리"로 바꿀 수 있습니다. |
| 계절 전환 알림 | 여름과 겨울이 바뀔 때 배너와 계절음을 냅니다. |
| 진입음 | 묶음마다 기본 소리, Module에 든 다른 소리, 내 소리, 끔 중 하나를 고릅니다. 상위 바다·해역별로 따로 정할 수 있고 더 작은 단위가 우선합니다. |
| 계절 전환음 | 여름이 될 때, 겨울이 될 때 소리를 고릅니다. |
| 내 소리 | ogg·mp3·wav 파일(4 MiB·10초 이하)을 32개까지 가져옵니다. Module을 제거하면 가져온 소리도 함께 지워집니다. |

볼륨과 음소거는 Navigator 설정의 Module 소리(기본 50%)에서 정합니다.

## 소리 출처

모든 소리는 CC0 1.0이거나 제작 저장소에서 직접 합성한 소리입니다(Freesound 25개, OpenGameArt 4개, Kenney Music Jingles 2개,
직접 합성 1개). 저작자와 출처 전체 목록은 [SOUNDS.md](https://github.com/DHO-Unofficial-Dev/dho-module-herald/blob/main/SOUNDS.md)와
설정 창의 "소리 출처(CC0) 보기"에 있습니다.

## 라이선스

코드와 문서는 MIT, 소리 파일은 CC0 1.0입니다. 자세한 내용은
[LICENSE](https://github.com/DHO-Unofficial-Dev/dho-module-herald/blob/main/LICENSE)를 보세요.

제작 저장소: [DHO-Unofficial-Dev/dho-module-herald](https://github.com/DHO-Unofficial-Dev/dho-module-herald)
