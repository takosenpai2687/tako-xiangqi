type SoundName =
  | "pickup" | "redMove" | "blackMove" | "capture" | "undo"
  | "cupLift" | "teaSip" | "cupPlace";
type PlayingSide = "red" | "black";

export class GameAudio {
  private readonly clips: Record<SoundName, HTMLAudioElement>;

  constructor() {
    const audioBase = `${import.meta.env.BASE_URL}audio/`;
    this.clips = {
      pickup: new Audio(`${audioBase}piece-pickup.mp3`),
      redMove: new Audio(`${audioBase}red-move.mp3`),
      blackMove: new Audio(`${audioBase}black-move.mp3`),
      capture: new Audio(`${audioBase}capture.mp3`),
      undo: new Audio(`${audioBase}undo.mp3`),
      cupLift: new Audio(`${audioBase}cup-lift.mp3`),
      teaSip: new Audio(`${audioBase}tea-sip.mp3`),
      cupPlace: new Audio(`${audioBase}cup-place.mp3`),
    };

    for (const clip of Object.values(this.clips)) clip.preload = "auto";
  }

  play(sound: SoundName): void {
    this.playClip(sound);
  }

  playMoveAndCapture(side: PlayingSide): void {
    const moveSound = side === "red" ? "redMove" : "blackMove";
    this.playClip(moveSound, () => {
      window.setTimeout(() => this.playClip("capture"), 35);
    });
  }

  private playClip(sound: SoundName, onEnded?: () => void): void {
    const playback = new Audio(this.clips[sound].src);
    playback.volume = 0.72;
    playback.onended = () => {
      playback.onended = null;
      onEnded?.();
    };

    void playback.play().catch((error: unknown) => {
      playback.onended = null;
      console.warn(`音效播放失败 (${sound}):`, error);
      onEnded?.();
    });
  }
}
