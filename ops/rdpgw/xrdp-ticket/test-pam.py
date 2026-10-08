#!/usr/bin/env python3
"""Runs the helper through the REAL libpam and the REAL pam_exec.so, with a throw-away PAM configuration directory
(pam_start_confdir): /etc is not read or written. curl is a fake, so nothing touches a network or a port.

    python3 -I ops/rdpgw/xrdp-ticket/test-pam.py

What it checks that the shell tests cannot: how pam_exec really delivers the password (stdin framing), that PAM_USER
reaches the script, that `sufficient` lets the login in on exit 0, and that on any other exit the stack carries on
to the next line (here: pam_deny, standing in for the ordinary password check).
"""
import ctypes, ctypes.util, os, shutil, stat, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
HELPER = os.path.join(HERE, "kalfa-xrdp-ticket")
TICKET = "k1." + "A" * 38

libpam = ctypes.CDLL(ctypes.util.find_library("pam") or "libpam.so.0")
libc = ctypes.CDLL(None)
libc.calloc.restype = ctypes.c_void_p
libc.strdup.restype = ctypes.c_void_p

class PamMessage(ctypes.Structure):
    _fields_ = [("msg_style", ctypes.c_int), ("msg", ctypes.c_char_p)]
class PamResponse(ctypes.Structure):
    _fields_ = [("resp", ctypes.c_void_p), ("resp_retcode", ctypes.c_int)]
CONV = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_int, ctypes.POINTER(ctypes.POINTER(PamMessage)),
                        ctypes.POINTER(ctypes.POINTER(PamResponse)), ctypes.c_void_p)
class PamConv(ctypes.Structure):
    _fields_ = [("conv", CONV), ("appdata_ptr", ctypes.c_void_p)]

PAM_PROMPT_ECHO_OFF, PAM_SUCCESS, PAM_AUTH_ERR = 1, 0, 7
libpam.pam_start_confdir.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.POINTER(PamConv), ctypes.c_char_p, ctypes.POINTER(ctypes.c_void_p)]
libpam.pam_authenticate.argtypes = [ctypes.c_void_p, ctypes.c_int]
libpam.pam_end.argtypes = [ctypes.c_void_p, ctypes.c_int]
libpam.pam_putenv.argtypes = [ctypes.c_void_p, ctypes.c_char_p]

work = tempfile.mkdtemp()
confdir = os.path.join(work, "pam.d"); os.mkdir(confdir)
open(os.path.join(confdir, "xrdp-sesman-test"), "w").write(
    f"auth sufficient pam_exec.so quiet expose_authtok {HELPER}\n"
    "auth requisite pam_deny.so\n")

# fake curl: records the call and the body, answers what the test says
fake = os.path.join(work, "curl")
open(fake, "w").write('#!/usr/bin/env bash\necho called >> "$FAKE_DIR/calls"\ncat > "$FAKE_DIR/body"\nprintf \'%s\' "$FAKE_ANSWER"\n')
os.chmod(fake, 0o755)
header = os.path.join(work, "header")
open(header, "w").write("Authorization: Bearer not-a-real-secret\n"); os.chmod(header, 0o600)
# pam_exec hands the script only PAM's own environment, so the test overrides go in through pam_putenv
PAM_ENV = {"KALFA_XRDP_TICKET_CURL": fake, "KALFA_XRDP_TICKET_HEADER_FILE": header, "FAKE_DIR": work}

def authenticate(user, password, answer):
    for name in ("calls", "body"):
        try: os.remove(os.path.join(work, name))
        except FileNotFoundError: pass
    keep = []
    def conv(n, msgs, resps, _):
        out = ctypes.cast(libc.calloc(n, ctypes.sizeof(PamResponse)), ctypes.POINTER(PamResponse))
        for i in range(n):
            if msgs[i].contents.msg_style == PAM_PROMPT_ECHO_OFF:
                out[i].resp = libc.strdup(password.encode())
        resps[0] = out
        return PAM_SUCCESS
    cb = CONV(conv); keep.append(cb)
    pamc = PamConv(cb, None)
    handle = ctypes.c_void_p()
    rc = libpam.pam_start_confdir(b"xrdp-sesman-test", user.encode(), ctypes.byref(pamc), confdir.encode(), ctypes.byref(handle))
    assert rc == PAM_SUCCESS, f"pam_start_confdir failed: {rc}"
    for key, value in {**PAM_ENV, "FAKE_ANSWER": answer}.items():
        assert libpam.pam_putenv(handle, f"{key}={value}".encode()) == PAM_SUCCESS
    result = libpam.pam_authenticate(handle, 0)
    libpam.pam_end(handle, result)
    calls = os.path.exists(os.path.join(work, "calls")) and len(open(os.path.join(work, "calls")).read().split())
    body = open(os.path.join(work, "body")).read() if os.path.exists(os.path.join(work, "body")) else None
    return result, int(calls or 0), body

failures = 0
def check(name, ok, detail=""):
    global failures
    print(("ok    " if ok else "FAIL  ") + name + ("" if ok else f"  [{detail}]"))
    failures += 0 if ok else 1

ALLOW, DENY = '{"allow":true}', '{"allow":false}'

os.environ["KALFA_XRDP_TICKET_URL"] = "http://127.0.0.1:1/api/internal/rdp-gateway/xrdp-ticket"  # must NOT reach the helper
rc, calls, body = authenticate("desktopuser", TICKET, ALLOW)
check("a valid ticket logs in (PAM_SUCCESS)", rc == PAM_SUCCESS, rc)
check("the helper called the app exactly once", calls == 1, calls)
check("the body carries exactly the ticket and PAM_USER, nothing from the NUL framing",
      body == '{"ticket":"%s","user":"desktopuser"}' % TICKET, body)

rc, calls, body = authenticate("desktopuser", TICKET, DENY)
check("a refused ticket falls through to the next module (login refused here)", rc == PAM_AUTH_ERR, rc)
check("it did ask the app", calls == 1, calls)

rc, calls, body = authenticate("desktopuser", TICKET, "")
check("an empty answer is a refusal", rc == PAM_AUTH_ERR, rc)

for password in ["hunter2", "correct horse battery staple", TICKET + "x", TICKET[:-1], "k2." + "A" * 38, ""]:
    rc, calls, body = authenticate("desktopuser", password, ALLOW)
    check(f"a normal password ({password[:12]!r}) is not sent anywhere and falls through", rc == PAM_AUTH_ERR and calls == 0, (rc, calls))

rc, calls, body = authenticate("desk top", TICKET, ALLOW)
check("a malformed user name is refused without a call", rc == PAM_AUTH_ERR and calls == 0, (rc, calls))

shutil.rmtree(work)
print("failures:", failures)
sys.exit(1 if failures else 0)
