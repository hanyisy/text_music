# 외계어 악보

키보드로 연주하면 한글 괴문자로 찍히고, 그 괴문자를 따라 치면 같은 곡이 나오는 웹 서비스. 설계는 [DESIGN.md](./DESIGN.md).

## 실행

빌드 과정이 없다. 정적 서버로 저장소 루트를 열면 된다(ES 모듈이라 `file://`로는 안 열린다).

```bash
npm start
```

```bash
npm test
```

## 구조

| 폴더 | 역할 |
| --- | --- |
| `engine/` | DOM·Web Audio에 의존하지 않는 순수 JS. 데스크톱 프로그램에서 그대로 재사용 |
| `audio/` | Web Audio 재생. 엔진이 만든 이벤트를 받아 소리만 낸다 |
| `ui/` | 입력창, 버튼, 화면 표시, 공유 링크 |
| `tests/` | 엔진 단위 테스트 (`node --test`) |

음 배치는 `engine/keymap.js`, 디자인 값(색·간격·글꼴)은 `ui/styles.css` 맨 위의 CSS 변수에서 바꾼다.
