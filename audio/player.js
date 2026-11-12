// 파서가 만든 악보(이벤트 목록)를 시간에 맞춰 신스로 재생한다.
// 화면은 모른다: 재생 위치는 콜백으로만 알린다.

const START_DELAY = 0.1;       // 재생 버튼을 누른 뒤 첫 음까지(초)
const LOOKAHEAD = 0.25;        // 이만큼 앞의 음까지 미리 예약(초)
const TICK_MS = 25;            // 예약 주기
const TAIL = 0.4;              // 마지막 음의 여운(초)

export class Player {
  #synth;
  #run = 0;
  #timer = null;
  #frame = null;
  #onSegment = null;
  #onEnd = null;

  constructor(synth) {
    this.#synth = synth;
  }

  get playing() {
    return this.#timer !== null;
  }

  /**
   * @param {{ events: object[], segments: object[], duration: number }} score  parser.parse 결과
   * @param {object} [callbacks]
   * @param {(segment: object | null) => void} [callbacks.onSegment]  지금 재생 중인 글자가 바뀔 때(끝나면 null)
   * @param {() => void} [callbacks.onEnd]                            끝까지 재생했거나 정지했을 때
   */
  async play(score, { onSegment, onEnd } = {}) {
    this.stop();
    const run = ++this.#run;
    await this.#synth.unlock();
    if (run !== this.#run) return;

    const ctx = this.#synth.context;
    const { events, segments, duration } = score;
    const startAt = ctx.currentTime + START_DELAY;
    let nextEvent = 0;
    let segmentIndex = -1;

    const schedule = () => {
      const horizon = ctx.currentTime - startAt + LOOKAHEAD;
      while (nextEvent < events.length && events[nextEvent].time < horizon) {
        const event = events[nextEvent++];
        this.#synth.play(event.sound, { when: startAt + event.time, duration: event.duration });
      }
    };

    const follow = () => {
      const position = ctx.currentTime - startAt;
      if (position >= duration + TAIL) {
        this.#finish(false);
        return;
      }
      let index = segmentIndex;
      while (index + 1 < segments.length && segments[index + 1].time <= position) index++;
      if (position >= duration) index = segments.length;
      if (index !== segmentIndex) {
        segmentIndex = index;
        onSegment?.(segments[index] ?? null);
      }
      this.#frame = requestAnimationFrame(follow);
    };

    this.#onSegment = onSegment ?? null;
    this.#onEnd = onEnd ?? null;
    this.#timer = setInterval(schedule, TICK_MS);
    schedule();
    this.#frame = requestAnimationFrame(follow);
  }

  stop() {
    this.#run++;
    if (this.playing) this.#finish(true);
  }

  #finish(silence) {
    clearInterval(this.#timer);
    cancelAnimationFrame(this.#frame);
    this.#timer = null;
    this.#frame = null;
    if (silence) this.#synth.stopAll();
    const onSegment = this.#onSegment;
    const onEnd = this.#onEnd;
    this.#onSegment = this.#onEnd = null;
    onSegment?.(null);
    onEnd?.();
  }
}
