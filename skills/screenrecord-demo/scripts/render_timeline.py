#!/usr/bin/env python3
"""Render a local-footage timeline. Run with --help for usage."""
import argparse
import json
import math
from pathlib import Path
import re
import shutil
import subprocess
import tempfile


def run(args):
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode:
        raise ValueError(f"{args[0]} failed: {result.stderr[-5000:]}")
    return result


def probe(path):
    return json.loads(run(["ffprobe", "-v", "error", "-show_format", "-show_streams",
                           "-of", "json", str(path)]).stdout)


def number(value, label, minimum=0):
    if isinstance(value, bool) or not isinstance(value, (float, int)):
        raise ValueError(f"{label} must be a number")
    if not math.isfinite(value) or value < minimum:
        raise ValueError(f"{label} must be finite and >= {minimum}")
    return value


def load_timeline(path, check_sources=True):
    path = Path(path).resolve()
    data = json.loads(path.read_text())
    if not isinstance(data, dict) or data.get("version") != 1:
        raise ValueError("Expected timeline version 1")
    for key, default in [("width", 1920), ("height", 1080), ("fps", 30)]:
        data.setdefault(key, default)
        value = number(data[key], key, 1)
        if int(value) != value or (key != "fps" and value % 2):
            raise ValueError(f"{key} must be an integer; dimensions must be even")
    if not isinstance(data.get("clips"), list) or not data["clips"]:
        raise ValueError("Provide at least one clip")
    metadata = {}
    for i, clip in enumerate(data["clips"]):
        if not isinstance(clip, dict):
            raise ValueError(f"clip {i} must be an object")
        start = number(clip["start"], f"clip {i} start")
        end = number(clip["end"], f"clip {i} end")
        duration = number(clip["duration"], f"clip {i} duration", 0.001)
        if end <= start:
            raise ValueError(f"clip {i}: end must follow start")
        frames = duration * data["fps"]
        if abs(frames - round(frames)) > 0.0001:
            raise ValueError(f"clip {i}: duration must align to the frame grid")
        source = clip["source"]
        if not isinstance(source, str) or not source or "://" in source:
            raise ValueError(f"clip {i}: supply a local source path")
        resolved = (path.parent / source).resolve()
        if check_sources:
            if not resolved.is_file():
                raise ValueError(f"Missing source: {resolved}")
            if str(resolved) not in metadata:
                metadata[str(resolved)] = probe(resolved)
            info = metadata[str(resolved)]
            if not any(s["codec_type"] == "video" for s in info["streams"]):
                raise ValueError(f"No video stream: {resolved}")
            length = float(info["format"]["duration"])
            if end > length + 1 / data["fps"]:
                raise ValueError(f"clip {i}: end {end} exceeds source duration {length}")
        clip["source"] = str(resolved)
    data["duration"] = sum(c["duration"] for c in data["clips"])
    return data


def render(args):
    for executable in ["ffmpeg", "ffprobe"]:
        if not shutil.which(executable):
            raise ValueError(f"Install {executable} or add it to PATH")
    data = load_timeline(args.timeline)
    out = args.out.resolve()
    if out.suffix.lower() != ".mp4":
        raise ValueError("Output must end in .mp4")
    extras = [out.with_suffix(s) for s in [".verification.json", ".poster.jpg", ".contact.jpg"]]
    for path in [out, *extras]:
        if path.exists() and not args.overwrite:
            raise ValueError(f"Output exists; use --overwrite: {path}")
    sources = {Path(c["source"]) for c in data["clips"]}
    if args.audio:
        args.audio = args.audio.resolve()
        sources.add(args.audio)
        info = probe(args.audio)
        if not any(s["codec_type"] == "audio" for s in info["streams"]):
            raise ValueError("Soundtrack has no audio stream")
        if float(info["format"]["duration"]) + 0.05 < data["duration"]:
            raise ValueError("Soundtrack is shorter than the timeline")
    if any(p in sources for p in [out, *extras]):
        raise ValueError("An output would overwrite an input")
    out.parent.mkdir(parents=True, exist_ok=True)
    fps, width, height = data["fps"], data["width"], data["height"]
    with tempfile.TemporaryDirectory(prefix="screenrecord-", dir=out.parent) as temporary:
        temp = Path(temporary)
        for i, clip in enumerate(data["clips"]):
            interval = clip["end"] - clip["start"]
            frames = round(clip["duration"] * fps)
            filters = (f"setpts={clip['duration']/interval}*(PTS-STARTPTS),fps={fps},"
                       f"scale={width}:{height}:force_original_aspect_ratio=decrease:flags=lanczos,"
                       f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,"
                       f"tpad=stop_mode=clone:stop_duration={1/fps}")
            destination = temp / f"clip-{i:04d}.mp4"
            run(["ffmpeg", "-y", "-v", "error", "-ss", str(clip["start"]), "-t", str(interval),
                 "-i", clip["source"], "-map", "0:v:0", "-vf", filters,
                 "-frames:v", str(frames), "-an", "-c:v", "libx264", "-preset", "veryfast",
                 "-threads", "2", "-crf", "19", "-pix_fmt", "yuv420p", str(destination)])
            info = probe(destination)
            if abs(float(info["format"]["duration"]) - clip["duration"]) > 1 / fps + 0.005:
                raise ValueError(f"Clip {i} rendered too short; inspect source timestamps")
            print(f"Rendered {i+1}/{len(data['clips'])}: {clip.get('name', i)}", flush=True)
        concat = temp / "concat.txt"
        concat.write_text("\n".join(f"file 'clip-{i:04d}.mp4'" for i in range(len(data["clips"]))))
        staged = temp / "finished.mp4"
        command = ["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "1", "-i", str(concat)]
        if args.audio:
            command += ["-i", str(args.audio), "-map", "0:v:0", "-map", "1:a:0", "-af",
                        "loudnorm=I=-19:TP=-2:LRA=8", "-c:a", "aac", "-b:a", "192k",
                        "-ar", "48000", "-ac", "2"]
        else:
            command += ["-map", "0:v:0", "-an"]
        run(command + ["-c:v", "copy", "-t", str(data["duration"]), "-movflags", "+faststart", str(staged)])
        info = probe(staged)
        video = next(s for s in info["streams"] if s["codec_type"] == "video")
        audio = [s for s in info["streams"] if s["codec_type"] == "audio"]
        if (video["width"], video["height"]) != (width, height):
            raise ValueError("Export dimensions do not match the timeline")
        if abs(float(info["format"]["duration"]) - data["duration"]) > 1 / fps + 0.05:
            raise ValueError("Export duration does not match the timeline")
        if bool(audio) != bool(args.audio):
            raise ValueError("Unexpected audio presence")
        run(["ffmpeg", "-v", "error", "-xerror", "-i", str(staged), "-f", "null", "-"])
        loudness = None
        if audio:
            measurement = run(["ffmpeg", "-v", "info", "-i", str(staged), "-vn", "-af",
                               "loudnorm=I=-19:TP=-2:LRA=8:print_format=json", "-f", "null", "-"])
            matches = re.findall(r'\{\s*"input_i".*?\}', measurement.stderr, re.S)
            if matches:
                loudness = json.loads(matches[-1])
        poster = temp / "poster.jpg"
        contact = temp / "contact.jpg"
        run(["ffmpeg", "-y", "-v", "error", "-ss", str(min(1, data["duration"]/2)),
             "-i", str(staged), "-frames:v", "1", "-update", "1", str(poster)])
        run(["ffmpeg", "-y", "-v", "error", "-i", str(staged), "-vf",
             f"fps={12/data['duration']},scale=480:-2,tile=4x3", "-frames:v", "1", "-update", "1", str(contact)])
        report = {"timeline": data, "soundtrack": str(args.audio) if args.audio else None,
                  "format": info["format"], "streams": info["streams"],
                  "full_decode_passed": True, "encoded_audio_loudness": loudness,
                  "human_review": "Still required: cut boundaries, legibility, content, pacing and listening."}
        report["format"]["filename"] = str(out)
        verification = temp / "verification.json"
        verification.write_text(json.dumps(report, indent=2) + "\n")
        for source, destination in zip([staged, verification, poster, contact], [out, *extras]):
            source.replace(destination)
    print(f"Saved {out} ({data['duration']:.3f} seconds)")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("timeline", type=Path, help="Version-1 JSON timeline; sources relative to this file")
    parser.add_argument("--out", type=Path, required=True, help="Destination MP4")
    parser.add_argument("--audio", type=Path, help="Optional continuous soundtrack; source audio is discarded")
    parser.add_argument("--overwrite", action="store_true", help="Replace outputs, never input footage")
    args = parser.parse_args()
    try:
        render(args)
    except (ValueError, KeyError, TypeError, OSError) as error:
        parser.exit(1, f"Error: {error}\n")


if __name__ == "__main__":
    main()
