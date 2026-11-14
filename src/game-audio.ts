import { resourceUrl } from "./resource-source";

type SoundName =
  | "pickup" | "redMove" | "blackMove" | "capture" | "undo"
  | "cupLift" | "teaSip" | "cupPlace";
type PlayingSide = "red" | "black";

export class GameAudio {
  private readonly clips: Record<SoundName, HTMLAudioElement>;

  constructor() {
    const clip = (filename: string): HTMLAudioElement => {
      const audio = new Audio();
      audio.crossOrigin = "anonymous";
      audio.src = resourceUrl(`audio/${filename}`);
      audio.onerror = () => console.warn("Could not load audio:", audio.src, audio.error);
      return audio;
    };
    this.clips = {
      pickup: clip("piece-pickup.mp3"),
      redMove: clip("red-move.mp3"),
      blackMove: clip("black-move.mp3"),
      capture: clip("capture.mp3"),
      undo: clip("undo.mp3"),
      cupLift: clip("cup-lift.mp3"),
      teaSip: clip("tea-sip.mp3"),
      cupPlace: clip("cup-place.mp3"),
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
    const playback = new Audio();
    playback.crossOrigin = "anonymous";
    playback.src = this.clips[sound].src;
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
