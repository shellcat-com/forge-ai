#!/usr/bin/env python3
"""Compose original lo-fi music and designed UI effects from output-time events."""
import argparse
import json
from pathlib import Path
import wave
from render_timeline import load_timeline, number


def compose(args):
    try:
        import numpy as np
    except ImportError as error:
        raise ValueError("NumPy is required; install it in a task-local Python environment") from error
    data = load_timeline(args.timeline, check_sources=False)
    sound = data.get("sound", {})
    if not isinstance(sound, dict):
        raise ValueError("sound must be an object")
    duration = data["duration"]
    if duration > 600:
        raise ValueError("Composer supports short walkthroughs up to 600 seconds; split longer projects")
    number(sound.get("bpm", 78), "sound bpm", 30)
    if sound.get("bpm", 78) > 200:
        raise ValueError("sound bpm must be <= 200")
    if not isinstance(sound.get("music", True), bool):
        raise ValueError("sound music must be true or false")
    for event in sound.get("typing", []):
        a = number(event["start"], "typing start")
        b = number(event["end"], "typing end")
        number(event.get("spacing", .105), "typing spacing", .03)
        if not a < b <= duration:
            raise ValueError("Typing ranges must fall within the output timeline")
    for at in sound.get("clicks", []):
        if number(at, "click time") >= duration:
            raise ValueError("Click time must precede the end of the timeline")
    out = args.out.resolve()
    if out.suffix.lower() != ".wav":
        raise ValueError("Output must end in .wav")
    event_path = out.with_suffix(".events.json")
    inputs = {args.timeline.resolve(), *(Path(c["source"]) for c in data["clips"])}
    for path in [out, event_path]:
        if path in inputs:
            raise ValueError("An output would overwrite an input")
        if path.exists() and not args.overwrite:
            raise ValueError(f"Output exists; use --overwrite: {path}")
    out.parent.mkdir(parents=True, exist_ok=True)
    RATE = 48000
    DURATION = duration
    rng = np.random.default_rng(sound.get("seed", 20260911))
    music = np.zeros((round(DURATION * RATE), 2), np.float32)
    foley = np.zeros_like(music)
    events = []
    def add(track, signal, at, gain=1, pan=0):
        start = round(at * RATE)
        if start < 0 or start >= len(track): return
        signal = signal[:len(track)-start]
        stereo = np.array([np.sqrt((1-pan)/2), np.sqrt((1+pan)/2)])
        track[start:start+len(signal)] += (signal[:, None] * stereo * gain).astype(np.float32)

    def time(d): return np.arange(round(d*RATE)) / RATE
    def freq(midi): return 440 * 2 ** ((midi-69)/12)
    def smooth(x, n): return np.convolve(x, np.ones(n)/n, mode='same')

    def rhodes(note, dur, velocity=1):
        t = time(dur); f = freq(note)
        wobble = .0008*np.sin(2*np.pi*.7*t)
        phase = 2*np.pi*f*t + wobble*f
        tone = np.sin(phase + .8*np.exp(-t*3)*np.sin(phase*2))
        tone += .12*np.sin(phase*3)*np.exp(-t*4)
        env = (1-np.exp(-t*180))*np.exp(-t/1.25)*np.minimum(1, (dur-t)*6)
        return tone*env*velocity

    # Original 78 BPM, swung instrumental: warm electric piano, bass and brushed drums.
    beat = 60/sound.get("bpm", 78)
    chords = [[53,57,60,64,67], [52,55,59,62,66], [50,53,57,60,64], [43,53,57,59,64]]
    basses = [29,28,26,31]
    melody = [[76,None,72,71], [74,None,71,67], [69,72,None,76], [74,71,69,None]]
    for bar in range(int(DURATION/(4*beat))+1 if sound.get("music", True) else 0):
        base = bar*4*beat; harmony = chords[bar%4]
        for j,n in enumerate(harmony):
            add(music, rhodes(n, 3.2), base+j*.013, .105, (j-2)*.22)
            add(music, rhodes(n, 1.35), base+2.65*beat+j*.009, .031, (2-j)*.18)
        for off, strength in [(0,.16),(1.65,.085),(2.5,.12)]:
            t=time(1.12); f=freq(basses[bar%4]); tone=np.sin(2*np.pi*f*t)+.17*np.sin(4*np.pi*f*t)
            env=(1-np.exp(-t*95))*np.exp(-t*2.9)*np.minimum(1,(1.12-t)*15)
            add(music,tone*env,base+off*beat,strength)
        if bar>=2:
            for j,n in enumerate(melody[(bar//2)%4]):
                if n is not None:
                    at=base+(j*.75+.4)*beat
                    line=rhodes(n,1.9)
                    add(music,line,at,.046,-.22)
                    add(music,line,at+.38,.013,.35)
        for off,g in [(0,.26),(1.75,.11),(2.5,.18)]:
            t=time(.4); phase=2*np.pi*(48*t+60*.022*(1-np.exp(-t/.022)))
            kick=np.sin(phase)*np.exp(-t*13)*(1-np.exp(-t*600))
            add(music,kick,base+off*beat,g)
        for off in [1,3]:
            t=time(.22); noise=smooth(rng.normal(size=len(t)),9)
            snare=noise*np.exp(-t*24)+.10*np.sin(2*np.pi*175*t)*np.exp(-t*36)
            add(music,snare,base+off*beat+.009,.15,-.08)
        for eighth in range(8):
            t=time(.075); noise=rng.normal(size=len(t)); hat=noise-smooth(noise,15)
            hat=smooth(hat,3)*np.exp(-t*75)
            swing=.067 if eighth%2 else 0
            add(music,hat,base+eighth*beat/2+swing,.021 if eighth%2 else .029,.3)

    # Soft room reflections. Effects are added only during visible interactions.
    for delay,gain in [(.079,.09),(.143,.06),(.227,.04)]:
        offset=round(delay*RATE)
        music[offset:] += music[:-offset,::-1].copy()*gain
    if np.any(music):
        music *= .067 / np.sqrt(np.mean(music**2))

    def key(at, heavy=False):
        t=time(.085); noise=rng.normal(size=len(t))
        thock=np.sin(2*np.pi*rng.uniform(190,280)*t)*np.exp(-t*65)
        top=(noise-smooth(noise,18))*np.exp(-t*310)
        body=smooth(noise,9)*np.exp(-t*90)
        sound=.62*thock+.23*top+.3*body
        gain=rng.uniform(.065,.092)*(1.22 if heavy else 1)
        add(foley,sound,at,gain,rng.uniform(-.22,.22))
        add(foley,sound,at+.033,gain*.24,.12)
        events.append({'type':'key','at':round(at,3)})

    def mouse(at):
        t=time(.05); noise=rng.normal(size=len(t))
        sound=.38*np.sin(2*np.pi*1250*t)*np.exp(-t*420)+.35*noise*np.exp(-t*610)
        add(foley,sound,at,.10,.12)
        add(foley,sound,at+.073,.055,.1)
        events.append({'type':'mouse','at':round(at,3)})


    # Effects track visible interactions, with human-sized bursts during accelerated typing.
    for event in sound.get("typing", []):
        at = event["start"]
        count = 0
        spacing = event.get("spacing", .105)
        while at < event["end"]:
            key(at, count % 16 == 15)
            at += rng.uniform(spacing*.65, spacing*1.3)
            count += 1
            if count % rng.integers(12, 23) == 0:
                at += rng.uniform(.13, .23)
    for at in sound.get("clicks", []):
        mouse(at)

    duck = np.ones(len(music), np.float32)
    for event in sound.get("typing", []):
        a, b = round(event["start"]*RATE), round(event["end"]*RATE)
        ramp = min(round(.16*RATE), (b-a)//2)
        window = np.full(b-a, .78, np.float32)
        if ramp:
            window[:ramp] = np.linspace(1, .78, ramp)
            window[-ramp:] = np.linspace(.78, 1, ramp)
        duck[a:b] = np.minimum(duck[a:b], window)
    music *= duck[:, None]
    mix = music + foley
    fade = np.ones(len(mix), np.float32)
    intro = min(RATE, len(mix)//2)
    outro = min(round(2.5*RATE), len(mix)//2)
    if intro:
        fade[:intro] = np.linspace(0, 1, intro)
    if outro:
        fade[-outro:] = np.linspace(1, 0, outro)**1.3
    mix *= fade[:, None]
    peak = float(np.max(np.abs(mix)))
    if peak > .94:
        mix *= .94/peak
    with wave.open(str(out), "wb") as output:
        output.setnchannels(2)
        output.setsampwidth(2)
        output.setframerate(RATE)
        output.writeframes((mix*32767).astype("<i2").tobytes())
    event_path.write_text(json.dumps({
        "duration": DURATION, "sample_rate": RATE, "events": events,
        "audio": "Original synthesized instrumental and designed UI effects; not recorded live sound.",
        "peak": float(np.max(np.abs(mix))), "sound": sound
    }, indent=2) + "\n")
    print(f"Saved {out} ({DURATION:.3f} seconds)")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("timeline", type=Path, help="JSON timeline with optional sound event configuration")
    parser.add_argument("--out", required=True, type=Path, help="Destination stereo 48 kHz WAV")
    parser.add_argument("--overwrite", action="store_true", help="Replace existing outputs")
    args = parser.parse_args()
    try:
        compose(args)
    except (ValueError, KeyError, TypeError, OSError) as error:
        parser.exit(1, f"Error: {error}\n")


if __name__ == "__main__":
    main()
