// The seam pass of the story flow's Final cut — cut-doctor + mix-doctor, ported
// from the Verdant pipeline (../vendant/.claude/skills/{cut-doctor,mix-doctor})
// into one program the stitch job runs on the box (media.js stitchScript).
//
// Two segments chained by a continuation nearly match at the cut, but not
// exactly: the incoming one spends a few frames settling (H3 opens on the
// previous segment's last frame, then moves off it), and the outgoing one's
// last frames are the model's weakest. And under the picture, every segment's
// sound is a self-contained piece — a fade-in from near silence, a swell into
// the ending — so a butt-join drops the bed off a cliff at every cut (measured
// on film-ab875030, H3: −23 dB at the first seam, −34 dB at the third).
//
//   PICTURE  A's last frames × B's first, scored pairwise with SSIM; the best
//            pairing (gently penalised for footage thrown away) is the cut.
//            Frames are kept by index and re-encoded in ONE pass from a raw
//            pipe — a filter-graph trim lands a frame off, which puts the seam
//            back where it was.
//   SOUND    each segment's audio placed at its kept frames; B's fade-in lifted
//            and A's tail eased to the level both meet at, then an equal-power
//            crossfade at the exact cut, its handle the real audio under A's
//            trimmed frames (mirrored when there is none).
//
// Leveling follows each side's own envelope, so a spoken line inside a window
// is barely touched on the way UP; turning a tail DOWN is where a line could be
// buried, so that is capped at MAX_CUT_DB (mix-doctor's own default is 18 dB —
// here it runs unattended, on dialogue).
//
// Stdlib + ffmpeg only. Writes the film and a JSON report of every joint.
//
//   python3 seam_edit.py --out film.mp4 --report seams.json --fps 24 \
//     --width 854 --height 480 n0.mkv n1.mkv …
//
// Kept as a String.raw template so the Worker can ship it in a job script:
// no backticks and no dollar-brace in the Python below.
export const SEAM_EDIT_PY = String.raw`
import argparse, json, math, os, re, shutil, subprocess, sys, tempfile
from array import array
from concurrent.futures import ThreadPoolExecutor

SR, CH = 48000, 2
WINDOW, MAX_TRIM, PENALTY = 8, 6, 0.004
FADE, HEAD_WIN, TAIL_WIN, MAX_BOOST_DB, MAX_CUT_DB = 0.125, 1.5, 1.5, 18.0, 6.0
NEG_INF = float('-inf')
SSIM_RE = re.compile(r'All:([0-9.]+)')

def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, **kw)

def frames_of(path):
    r = run(['ffprobe','-v','error','-select_streams','v:0','-count_frames',
             '-show_entries','stream=nb_read_frames','-of','csv=p=0', path], text=True)
    return int((r.stdout.strip().split('\n') or ['0'])[0] or 0)

# --- picture -----------------------------------------------------------------

def grab(path, lo, hi, outdir, tag):
    """frames [lo, hi) as PNGs, in order"""
    run(['ffmpeg','-y','-v','error','-i',path,'-map','0:v:0','-vf',
         "select='between(n\\,%d\\,%d)'" % (lo, hi - 1),'-vsync','0',
         os.path.join(outdir, tag + '_%03d.png')])
    return sorted(os.path.join(outdir, f) for f in os.listdir(outdir) if f.startswith(tag + '_'))

def ssim(a, b):
    r = run(['ffmpeg','-hide_banner','-i',a,'-i',b,'-lavfi','ssim','-f','null','-'], text=True)
    m = SSIM_RE.search(r.stderr)
    return float(m.group(1)) if m else 0.0

def measure_joint(a_path, a_frames, b_path, b_frames, wd, k):
    w = max(1, min(WINDOW, a_frames // 2, b_frames // 2))
    tail = grab(a_path, a_frames - w, a_frames, wd, 'a%d' % k)
    head = grab(b_path, 0, w, wd, 'b%d' % k)
    if not tail or not head:
        return None
    tail = list(reversed(tail))                     # i = frames trimmed off A's end
    pairs = [(i, j) for i in range(len(tail)) for j in range(len(head))]
    with ThreadPoolExecutor(max_workers=16) as ex:
        scores = list(ex.map(lambda p: ssim(tail[p[0]], head[p[1]]), pairs))
    grid = {p: s for p, s in zip(pairs, scores)}
    raw = grid[(0, 0)]
    best = (0, 0, raw, raw)
    for (i, j), s in grid.items():
        if i + j > MAX_TRIM:
            continue
        adj = s - PENALTY * (i + j)
        if adj > best[3]:
            best = (i, j, s, adj)
    return {'raw': raw, 'trimOut': best[0], 'trimIn': best[1], 'best': best[2]}

# --- sound (mix-doctor) --------------------------------------------------------

def decode_audio(path):
    r = run(['ffmpeg','-v','error','-i',path,'-vn','-f','f32le','-acodec','pcm_f32le',
             '-ac',str(CH),'-ar',str(SR),'-'])
    a = array('f'); a.frombytes(r.stdout)
    if sys.byteorder != 'little': a.byteswap()
    return a

def db(x): return 20 * math.log10(x) if x > 0 else NEG_INF

def rms_db(buf, f0, f1):
    f0, f1 = max(f0, 0) * CH, min(f1, len(buf) // CH) * CH
    if f1 <= f0: return NEG_INF
    seg = buf[f0:f1]
    return db(math.sqrt(sum(v * v for v in seg) / len(seg)))

def envelope(buf, f0, f1, hop=0.05, smooth=3):
    h = int(SR * hop); bins = []
    for s in range(f0, f1, h):
        bins.append((s + h // 2, rms_db(buf, s, min(s + h, f1))))
    vals = [v for _, v in bins]
    out = []
    for i, (c, _) in enumerate(bins):
        win = [v for v in vals[max(0, i - smooth // 2):i + smooth // 2 + 1] if v > NEG_INF]
        out.append((c, sum(win) / len(win) if win else NEG_INF))
    return out

def interp(env, f):
    if f <= env[0][0]: return env[0][1]
    if f >= env[-1][0]: return env[-1][1]
    for (c0, v0), (c1, v1) in zip(env, env[1:]):
        if c0 <= f <= c1:
            t = (f - c0) / (c1 - c0) if c1 > c0 else 0
            return v0 + (v1 - v0) * t
    return env[-1][1]

def finite(x, floor=-90.0):
    return x if x > NEG_INF else floor

def mix_audio(clips, fps):
    """clips: [{pcm, head, kept}] → (interleaved mix, per-joint report)"""
    F = int(round(FADE * SR))
    at = lambda frames: int(round(SR * frames / fps))
    for c in clips:
        c['s0'] = at(c['head'])
        c['body_len'] = at(c['kept'])
        c['avail'] = max(0, len(c['pcm']) // CH - (c['s0'] + c['body_len']))
    P, pos = [], 0
    for c in clips:
        P.append(pos); pos += c['body_len']
    N = pos

    raw = array('f', bytes(N * CH * 4))
    for c, p in zip(clips, P):
        chunk = c['pcm'][c['s0'] * CH:(c['s0'] + c['body_len']) * CH]
        raw[p * CH:p * CH + len(chunk)] = chunk

    W_out, W_in, M = int(TAIL_WIN * SR), int(HEAD_WIN * SR), int(0.2 * SR)
    report, gains = [], []
    for k in range(len(clips) - 1):
        T = P[k + 1]
        tailA, headB = finite(rms_db(raw, T - M, T)), finite(rms_db(raw, T, T + M))
        target = finite(rms_db(raw, T + W_in - M, T + W_in))
        envA = [(c, finite(v)) for c, v in envelope(raw, T - W_out, T)]
        envB = [(c, finite(v)) for c, v in envelope(raw, T, T + W_in)]
        G_A = max(-MAX_CUT_DB, min(6.0, target - envA[-1][1]))
        gains.append((T, target, G_A, envA, envB))
        report.append({'before': round(headB - tailA, 1), 'gainTail': round(G_A, 1),
                       'boostHead': round(max(0.0, min(MAX_BOOST_DB, target - headB)), 1),
                       'handleRealMs': round(1000 * min(F, clips[k]['avail']) / SR)})

    mix = array('f', bytes(N * CH * 4))
    stems = []
    for k, (c, p) in enumerate(zip(clips, P)):
        L = c['body_len']
        body = array('f', c['pcm'][c['s0'] * CH:(c['s0'] + L) * CH])
        if len(body) < L * CH: body.extend([0.0] * (L * CH - len(body)))
        if k > 0:                                    # lift B's fade-in toward the meeting level
            T, target, _, _, envB = gains[k - 1]
            for f in range(min(W_in, L)):
                w = 1.0 if f < 0.7 * W_in else 0.5 * (1 + math.cos(math.pi * (f - 0.7 * W_in) / (0.3 * W_in)))
                g = max(0.0, min(MAX_BOOST_DB, target - interp(envB, T + f))) * w
                if g > 0.01:
                    m = 10 ** (g / 20); i = f * CH
                    body[i] *= m; body[i + 1] *= m
        handle = array('f')
        if k < len(clips) - 1:                       # ease A's tail to it, then the handle
            T, target, G_A, envA, _ = gains[k]
            gA = 10 ** (G_A / 20)
            for f in range(max(0, L - W_out), L):
                t = (f - (L - W_out)) / W_out
                w = 0.5 * (1 - math.cos(math.pi * t / 0.6)) if t < 0.6 else 1.0
                g = max(-MAX_CUT_DB, min(6.0, target - interp(envA, T - W_out + f - (L - W_out)))) * w
                if abs(g) > 0.01:
                    m = 10 ** (g / 20); i = f * CH
                    body[i] *= m; body[i + 1] *= m
            real = min(F, c['avail'])
            s = (c['s0'] + L) * CH
            handle.extend(c['pcm'][s:s + real * CH])
            if real < F:                             # mirror the tail to fill the handle
                tail = body[(L - (F - real)) * CH:L * CH]
                for f in range(F - real):
                    j = (F - real - 1 - f) * CH
                    handle.extend(tail[j:j + CH])
            for f in range(len(handle) // CH):
                m = gA * math.cos(math.pi / 2 * (f + 0.5) / F); i = f * CH
                handle[i] *= m; handle[i + 1] *= m
        if k > 0:                                    # equal-power fade in at the cut
            for f in range(min(F, L)):
                m = math.sin(math.pi / 2 * (f + 0.5) / F); i = f * CH
                body[i] *= m; body[i + 1] *= m
        stems.append((p, body, handle))

    # bodies first, then handles — a handle lives under the NEXT body's head
    for p, body, _ in stems:
        mix[p * CH:p * CH + len(body)] = body
    for p, body, handle in stems:
        base = p * CH + len(body)
        for i in range(len(handle)):
            if base + i < len(mix): mix[base + i] += handle[i]

    for k in range(len(clips) - 1):
        T = P[k + 1]
        report[k]['after'] = round(finite(rms_db(mix, T, T + M)) - finite(rms_db(mix, T - M, T)), 1)

    peak = max((abs(v) for v in mix), default=0.0)
    if peak > 0.98:
        g = 0.98 / peak
        for i in range(len(mix)): mix[i] *= g
    return mix, report, P

# --- the film ------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--report', required=True)
    ap.add_argument('--fps', type=float, default=24.0)
    ap.add_argument('--width', type=int, required=True)
    ap.add_argument('--height', type=int, required=True)
    ap.add_argument('clips', nargs='+')
    a = ap.parse_args()

    clips = [{'path': p, 'frames': frames_of(p), 'head': 0, 'tail': 0} for p in a.clips]
    if any(c['frames'] < 2 for c in clips):
        sys.exit('a clip has no frames')

    joints = []
    wd = tempfile.mkdtemp(prefix='seam-')
    try:
        for k in range(len(clips) - 1):
            A, B = clips[k], clips[k + 1]
            m = measure_joint(A['path'], A['frames'], B['path'], B['frames'], wd, k) or \
                {'raw': None, 'trimOut': 0, 'trimIn': 0, 'best': None}
            joints.append(m)
            A['tail'] = max(A['tail'], m['trimOut'])
            B['head'] = max(B['head'], m['trimIn'])
    finally:
        shutil.rmtree(wd, ignore_errors=True)
    for c in clips:
        c['kept'] = c['frames'] - c['head'] - c['tail']

    for c in clips:
        c['pcm'] = decode_audio(c['path'])
    mix, audio, P = mix_audio(clips, a.fps)
    mix_path = a.out + '.mix.f32'
    if sys.byteorder != 'little': mix.byteswap()
    with open(mix_path, 'wb') as fh:
        fh.write(mix.tobytes())
    mix = None
    for c in clips: c['pcm'] = None

    # The picture: every kept frame, by index, through one raw pipe into one encode.
    fsize = a.width * a.height * 3 // 2
    enc = subprocess.Popen(['ffmpeg','-hide_banner','-v','error','-y',
        '-f','rawvideo','-pix_fmt','yuv420p','-s','%dx%d' % (a.width, a.height),'-framerate',str(a.fps),'-i','-',
        '-f','f32le','-ar',str(SR),'-ac',str(CH),'-i',mix_path,
        '-map','0:v','-map','1:a','-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p',
        '-c:a','aac','-b:a','160k','-movflags','+faststart', a.out], stdin=subprocess.PIPE)
    written = 0
    try:
        for c in clips:
            lo, hi = c['head'], c['head'] + c['kept'] - 1
            dec = subprocess.Popen(['ffmpeg','-v','error','-i',c['path'],'-map','0:v:0',
                '-vf',"select='between(n\\,%d\\,%d)'" % (lo, hi),'-vsync','0',
                '-f','rawvideo','-pix_fmt','yuv420p','-'], stdout=subprocess.PIPE)
            n = 0
            while True:
                chunk = dec.stdout.read(fsize * 16)
                if not chunk: break
                enc.stdin.write(chunk); n += len(chunk)
            dec.wait()
            got = n // fsize
            if got != c['kept']:
                raise SystemExit('clip %s: kept %d frames, decoded %d' % (c['path'], c['kept'], got))
            written += got
    finally:
        enc.stdin.close()
        enc.wait()
        try: os.remove(mix_path)
        except OSError: pass
    if enc.returncode:
        sys.exit('the encode failed')

    report = {
        'fps': a.fps, 'frames': written, 'seconds': round(written / a.fps, 3),
        'clips': [{'head': c['head'], 'tail': c['tail'], 'kept': c['kept'], 'frames': c['frames']} for c in clips],
        'joints': [{
            'at': round(P[k + 1] / SR, 3),
            'ssimBefore': None if j['raw'] is None else round(j['raw'], 4),
            'ssimAfter': None if j['best'] is None else round(j['best'], 4),
            'trimOut': j['trimOut'], 'trimIn': j['trimIn'],
            'audioStepBefore': audio[k]['before'], 'audioStepAfter': audio[k]['after'],
            'gainTail': audio[k]['gainTail'], 'boostHead': audio[k]['boostHead'],
            'handleRealMs': audio[k]['handleRealMs'],
        } for k, j in enumerate(joints)],
    }
    with open(a.report, 'w') as fh:
        json.dump(report, fh)
    print(json.dumps(report))

if __name__ == '__main__':
    main()
`;
