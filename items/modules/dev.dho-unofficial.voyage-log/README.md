# Logbook

항해 일지 Module입니다. 항차마다 출발·도착 항구, 걸린 항해일수, 평균 속도와 날짜를 기록하고 같은 구간(출발·도착 거점이 같은
항차)의 지난 기록과 비교합니다.

- Navigator 본창의 Module 화면에서 "항차 기록" 패널을 엽니다. 패널을 닫아 둬도 background service가 계속 기록합니다.
- 패널에는 현재 항차, 같은 구간 비교(최고·평균·횟수), 기록 표(운행 시간·계절·구간·일수·평균 속도·이번 차이)가 나옵니다.
  기록 줄을 펼치면 지나간 해역과 우회 판정을 봅니다.
- 항구에 들어가면 게임 화면에 짧은 도착 알림을 띄웁니다. 소리는 내지 않습니다. HUD를 꺼 두면 본창 알림 목록에만 남습니다.
- 기록은 최근 500항차까지 이 PC에만 저장합니다. 네트워크 권한이 없어 기록이 밖으로 나가지 않습니다.
- 기록을 CSV(UTF-8, BOM 포함)로 내보낼 수 있습니다.

## 권한

| 권한 | 쓰는 곳 |
| --- | --- |
| `navigation.read` | 출항·입항·항차 시작·끝 이벤트, 항해일수·이동 거리, 거점 이름 읽기 |
| `service.background` | 패널을 닫아 둬도 기록하는 background service |
| `storage.local` | 기록과 지금 항차 저장 |
| `notifications.show` | 도착 알림 |
| `settings.read` | 도착 알림 켜기·끄기 설정 읽기 |
| `files.user` | 기록을 CSV 파일로 내보내기(누를 때마다 저장 위치를 고릅니다) |

## 기록 규칙 요약

- 항차 경계는 Navigator의 항차를 따릅니다. 입항하면 그 항차를 "확정 전"으로 넣고 다음 출항 때 확정합니다.
- 출발지는 그 항차의 출항 거점, 도착지는 마지막 입항 거점입니다. 입항·출항은 측량 표시가 사라지고 다시 나타나는 것을 보고
  추정하므로 확정 신호가 아닙니다.
- 측량 판독이 잠깐 끊겨 항차만 바뀐 경우는 같은 뱃길로 보고 한 기록으로 이어 갑니다.
- 같은 구간 비교는 같은 계절(출발 계절) 기록을 먼저 씁니다. 같은 계절 기록이 없으면 "계절 무관"으로 비교합니다.
- 같은 해역을 세 번 이상 들렀거나 이동 거리가 두 항구 직선 거리의 3배를 넘으면 "우회" 항차로 보고 비교에서 뺍니다.
  펼친 줄에서 직접 넣거나 뺄 수 있습니다.
- 평균 속도는 판독한 이동 거리를 움직인 시간으로 나눈 값입니다. 정박 시간과 바다에서 멈춰 있던 시간은 뺍니다.

전체 규칙은 [제작 저장소 README](https://github.com/DHO-Unofficial-Dev/dho-module-logbook#readme)에 있습니다.

## 라이선스

MIT. [LICENSE](https://github.com/DHO-Unofficial-Dev/dho-module-logbook/blob/main/LICENSE)를 보세요.

제작 저장소: [DHO-Unofficial-Dev/dho-module-logbook](https://github.com/DHO-Unofficial-Dev/dho-module-logbook)
