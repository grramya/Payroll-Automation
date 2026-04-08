# =============================================================================
# app.py -- Payroll JE Automation  (Router + Design System)
# Routes: 1=Generate JE  2=JE Preview  3=Edit Mapping  4=QuickBooks  5=Activity Log
# =============================================================================
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

import streamlit as st

st.set_page_config(
    page_title="Payroll JE Automation",
    page_icon="",
    layout="wide",
    initial_sidebar_state="expanded",
)

from views.shared import init_session_state, render_sidebar

try:
    from processing.aggregator   import aggregate_by_department, process_special_columns, aggregate_company_wide  # noqa
    from processing.je_builder   import build_je  # noqa
    from processing.validator    import validate_payroll_df, validate_mapping, validate_je  # noqa
    from processing.consolidator import append_input_to_consolidated  # noqa
    from processing.logger       import log_action_async, compute_je_diff  # noqa
except Exception:
    pass

st.markdown("""
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/icon?family=Material+Icons+Round" rel="stylesheet">
""", unsafe_allow_html=True)

st.markdown("""
<style>

/* ── Skip-to-content (WCAG 2.4.1 — keyboard users) ──────────────────────── */
.skip-link {
    position:fixed; top:-100%; left:16px; z-index:9999;
    background:var(--p); color:#fff; padding:10px 20px;
    border-radius:0 0 var(--r8) var(--r8); font-weight:700; font-size:14px;
    text-decoration:none; transition:top .15s;
    box-shadow:0 4px 16px rgba(0,0,0,.25);
}
.skip-link:focus { top:0; }

/* ── Material Icons ──────────────────────────────────────────────────────── */
@import url('https://fonts.googleapis.com/icon?family=Material+Icons+Round');
.material-icons-round {
    font-family:'Material Icons Round'!important; font-style:normal!important;
    font-weight:normal!important; display:inline-flex!important;
    align-items:center!important; justify-content:center!important;
    line-height:1!important; letter-spacing:normal!important;
    text-transform:none!important; white-space:nowrap!important;
    word-wrap:normal!important; direction:ltr!important;
    -webkit-font-feature-settings:'liga'!important;
    font-feature-settings:'liga'!important;
    -webkit-font-smoothing:antialiased!important;
}

/* ── Design tokens ───────────────────────────────────────────────────────── */
:root {
  --p:          #400f61;
  --p-dark:     #2d0a45;
  --p-light:    #f5eefa;
  --p-ring:     rgba(64,15,97,.18);
  --g:          #595959;
  --g-light:    #f5f5f5;
  --border:     #d4d0da;
  --text:       #1a1a1a;
  --muted:      #595959;
  --disabled:   #767676;
  --surface:    #ffffff;
  --bg:         #fafafa;
  --ok:         #1b5e20;
  --ok-bg:      #e8f5e9;
  --warn:       #bf360c;
  --warn-bg:    #fff3e0;
  --err:        #b71c1c;
  --err-bg:     #ffebee;
  --r4:4px; --r6:6px; --r8:8px; --r12:12px;
  /* Fluid spacing scale */
  --space-xs:   clamp(4px,  0.5vw, 6px);
  --space-sm:   clamp(8px,  1vw,   12px);
  --space-md:   clamp(12px, 1.5vw, 20px);
  --space-lg:   clamp(20px, 2.5vw, 32px);
  /* Fluid type scale */
  --fs-xs:      clamp(10px, 1.1vw, 11px);
  --fs-sm:      clamp(12px, 1.3vw, 13.5px);
  --fs-base:    clamp(13px, 1.4vw, 15px);
  --fs-md:      clamp(15px, 1.7vw, 17px);
  --fs-lg:      clamp(18px, 2.2vw, 22px);
  --fs-xl:      clamp(22px, 2.8vw, 28px);
}

/* ── Full-viewport lock — prevents a page-level scrollbar ───────────────── */
html {
    height:100vh!important; overflow:hidden!important;
    scroll-behavior:smooth;
}
body {
    height:100vh!important; overflow:hidden!important;
    margin:0!important; padding:0!important;
}
::selection { background:var(--p-light); color:var(--p-dark); }

/* ── Prevent fade during reruns ──────────────────────────────────────────── */
[data-testid="stApp"],[data-testid="stAppViewContainer"],[data-testid="stMain"],
[data-testid="stAppViewBlockContainer"],[data-stale="true"],[data-stale="true"] *,
.block-container,.main { opacity:1!important; transition:none!important; }

/* ── Fluid container — no fixed max-width trap ───────────────────────────── */
.block-container {
    padding-top:    clamp(0.75rem, 2vw, 1.5rem)!important;
    padding-bottom: 4rem!important;
    padding-left:   clamp(0.75rem, 3vw, 2rem)!important;
    padding-right:  clamp(0.75rem, 3vw, 2rem)!important;
    max-width:      min(1140px, 100%)!important;
    width:          100%!important;
    box-sizing:     border-box!important;
}

/* ── Hide noisy Streamlit chrome ─────────────────────────────────────────── */
[data-testid="stFileUploaderDropzoneInstructions"] div small { display:none; }
[data-testid="glideDataEditorContainer"] button,
[data-testid="glideDataEditorContainer"] [class*="headerMenu"],
[data-testid="glideDataEditorContainer"] [class*="sortIcon"],
[data-testid="glideDataEditorContainer"] [class*="sort-icon"],
[data-testid="glideDataEditorContainer"] [aria-label*="sort"],
[data-testid="glideDataEditorContainer"] [aria-label*="menu"] { display:none!important; }

/* ── Hide Streamlit's fixed bottom toolbar (status widget + deploy menu) ─── */
/* These sit fixed over the page and obscure bottom content                    */
[data-testid="stStatusWidget"],
[data-testid="stBottom"],
[data-testid="stAppDeployButton"],
.stDeployButton,
footer,
footer[data-testid="stFooter"] { display:none!important; }

/* ══════════════════════════════════════════════════════════════════════════
   SIDEBAR
   ══════════════════════════════════════════════════════════════════════════ */
section[data-testid="stSidebar"],
section[data-testid="stSidebar"] > div,
section[data-testid="stSidebar"] > div > div,
[data-testid="stSidebarContent"],
[data-testid="stSidebarUserContent"] {
    background:#ffffff!important;
}
section[data-testid="stSidebar"] {
    flex-shrink:0!important;
    position:relative!important;
    /* overflow:visible lets the #pj-toggle pill protrude past the right border */
    overflow:visible!important;
    border-right:1px solid #e8e3f0!important;
    transition:width .25s cubic-bezier(.4,0,.2,1),
               transform .25s cubic-bezier(.4,0,.2,1)!important;
}
/* All inner wrappers — transparent pass-through so > div can scroll */
section[data-testid="stSidebar"] > div > div,
[data-testid="stSidebarContent"],
[data-testid="stSidebarUserContent"] {
    overflow:visible!important;
    height:auto!important;
}
/* THE scroll container */
section[data-testid="stSidebar"] > div {
    height:calc(100vh - 56px)!important;
    max-height:calc(100vh - 56px)!important;
    overflow-y:auto!important;
    overflow-x:hidden!important;
    padding:12px clamp(0.75rem,1.5vw,1rem) 1.5rem!important;
    box-sizing:border-box!important;
    scrollbar-width:thin!important;
    scrollbar-color:rgba(64,15,97,.4) #ede6f8!important;
}
section[data-testid="stSidebar"] > div::-webkit-scrollbar { width:5px!important; }
section[data-testid="stSidebar"] > div::-webkit-scrollbar-track {
    background:#ede6f8!important; border-radius:3px!important;
}
section[data-testid="stSidebar"] > div::-webkit-scrollbar-thumb {
    background:rgba(64,15,97,.4)!important; border-radius:3px!important;
}
section[data-testid="stSidebar"] > div::-webkit-scrollbar-thumb:hover {
    background:rgba(64,15,97,.65)!important;
}

/* Brand */
.sb-brand {
    display:flex; align-items:center; gap:12px;
    padding:0 0 16px 0; margin-bottom:14px;
    border-bottom:2px solid #f0eaf7;
}
.sb-mark {
    width:40px; height:40px; border-radius:10px; flex-shrink:0;
    background:var(--p); color:#fff;
    display:flex; align-items:center; justify-content:center;
    font-size:13px; font-weight:800; letter-spacing:.3px;
    box-shadow:0 2px 8px var(--p-ring);
}
.sb-name    { font-size:14px; font-weight:700; color:var(--text); line-height:1.25; }
.sb-tagline { font-size:10px; color:var(--muted); font-weight:600;
              text-transform:uppercase; letter-spacing:.8px; }

/* Section labels */
.sb-lbl {
    font-size:10px!important; font-weight:700!important;
    text-transform:uppercase!important; letter-spacing:1.1px!important;
    color:#9e9e9e!important; margin:0 0 8px 2px!important; display:block!important;
}

/* Nav buttons */
section[data-testid="stSidebar"] .stButton > button {
    width:100%!important; text-align:left!important; justify-content:flex-start!important;
    border-radius:var(--r8)!important; padding:10px 14px!important;
    font-size:13.5px!important; font-weight:500!important;
    min-height:44px!important; margin:2px 0!important;
    transition:background .15s,border-color .15s,color .15s,box-shadow .15s!important;
    letter-spacing:.1px!important;
    touch-action:manipulation!important;
}
section[data-testid="stSidebar"] .stButton > button[kind="primary"] {
    background:var(--p)!important; color:#fff!important;
    border:2px solid var(--p)!important;
    box-shadow:0 3px 8px var(--p-ring)!important;
}
section[data-testid="stSidebar"] .stButton > button[kind="primary"]:focus-visible {
    outline:3px solid var(--p-dark)!important; outline-offset:2px!important;
}
section[data-testid="stSidebar"] .stButton > button[kind="secondary"] {
    background:transparent!important; color:var(--text)!important;
    border:1px solid #ddd8e6!important; box-shadow:none!important;
}
section[data-testid="stSidebar"] .stButton > button[kind="secondary"]:hover {
    background:var(--p-light)!important; border-color:var(--p)!important; color:var(--p)!important;
}
section[data-testid="stSidebar"] .stButton > button[kind="secondary"]:focus-visible {
    outline:3px solid var(--p)!important; outline-offset:2px!important;
}
section[data-testid="stSidebar"] .stButton > button:disabled {
    opacity:.42!important; cursor:not-allowed!important; pointer-events:none!important;
}

/* Sidebar download buttons */
section[data-testid="stSidebar"] .stDownloadButton > button {
    width:100%!important; text-align:left!important; justify-content:flex-start!important;
    background:transparent!important; color:var(--text)!important;
    border:1px solid #ddd8e6!important; border-radius:var(--r8)!important;
    padding:9px 14px!important; font-size:13px!important; font-weight:400!important;
    min-height:44px!important; margin:3px 0!important;
    transition:background .15s,border-color .15s,color .15s!important;
    touch-action:manipulation!important;
}
section[data-testid="stSidebar"] .stDownloadButton > button:hover {
    background:var(--p-light)!important; border-color:var(--p)!important; color:var(--p)!important;
}
section[data-testid="stSidebar"] .stDownloadButton > button:focus-visible {
    outline:3px solid var(--p)!important; outline-offset:2px!important;
}

/* QBO status chips */
.sb-chip {
    display:flex; align-items:center; gap:8px;
    padding:7px 12px; border-radius:var(--r8);
    font-size:var(--fs-sm); font-weight:600; margin:4px 0 2px 0;
}
.sb-chip .material-icons-round { font-size:17px!important; }
.sb-chip.ok   { background:var(--ok-bg);   color:var(--ok);   }
.sb-chip.warn { background:var(--warn-bg); color:var(--warn); }
.sb-chip.err  { background:var(--err-bg);  color:var(--err);  }
.sb-chip-detail { font-size:11px; color:var(--disabled); padding:0 12px 8px 12px; }

/* ══════════════════════════════════════════════════════════════════════════
   MUI STEPPER — responsive: full labels on md+, icons-only on small screens
   ══════════════════════════════════════════════════════════════════════════ */
.mstepper {
    display:flex; align-items:flex-start; width:100%;
    padding:16px 0 20px 0; margin:0;
}
.mstep {
    display:flex; flex-direction:column; align-items:center;
    flex:1; position:relative; min-width:0;
}
.mstep::before {
    content:''; position:absolute; top:16px;
    left:calc(-50% + 18px); width:calc(100% - 36px);
    height:2px; background:#ddd8e6; z-index:0;
    transition:background .3s ease!important;
}
.mstep:first-child::before { display:none; }
.mstep.done::before   { background:var(--p); }
.mstep.active::before { background:var(--p); }

.mstep-c {
    width:32px; height:32px; border-radius:50%;
    display:flex; align-items:center; justify-content:center;
    position:relative; z-index:1;
    font-size:13px; font-weight:700; line-height:1;
    transition:background .2s ease, box-shadow .2s ease, transform .2s ease!important;
}
.mstep.done   .mstep-c { background:var(--p); color:#fff; }
.mstep.active .mstep-c {
    background:var(--p); color:#fff;
    box-shadow:0 0 0 5px var(--p-ring);
    transform:scale(1.08);
}
.mstep.pending .mstep-c { background:#fff; color:var(--disabled); border:2px solid #bbb6c8; }
.mstep-c .material-icons-round { font-size:17px!important; }

.mstep-lbl {
    margin-top:8px; font-size:var(--fs-xs); font-weight:600;
    text-align:center; color:var(--text); line-height:1.3; padding:0 4px;
    transition:color .2s ease!important;
}
.mstep.pending .mstep-lbl { color:var(--disabled); font-weight:400; }
.mstep.active  .mstep-lbl { color:var(--p); }

/* Small screens: hide stepper labels to prevent overflow */
@media (max-width: 540px) {
    .mstep-lbl { display:none; }
    .mstep-c   { width:28px; height:28px; font-size:11px; }
    .mstep::before { top:14px; left:calc(-50% + 15px); width:calc(100% - 30px); }
    .mstepper { padding:12px 0 14px 0; }
}
/* Medium screens: smaller labels */
@media (min-width:541px) and (max-width:768px) {
    .mstep-lbl { font-size:10px; padding:0 2px; }
}

/* ══════════════════════════════════════════════════════════════════════════
   PAGE HEADER — fluid icon + title scale
   ══════════════════════════════════════════════════════════════════════════ */
.pg-hdr {
    display:flex; align-items:flex-start;
    gap:clamp(10px, 1.5vw, 16px);
    padding:16px 0 20px 0;
    border-bottom:1px solid #ece6f5;
    margin-bottom:clamp(16px, 2.5vw, 28px);
    margin-top:0;
}
.pg-hdr-icon {
    width:clamp(40px, 5vw, 52px);
    height:clamp(40px, 5vw, 52px);
    border-radius:clamp(8px, 1.2vw, 12px);
    flex-shrink:0;
    background:var(--p-light);
    display:flex; align-items:center; justify-content:center;
    transition:transform .2s ease!important;
}
.pg-hdr-icon .material-icons-round {
    font-size:clamp(20px, 2.5vw, 26px)!important; color:var(--p)!important;
}
.pg-hdr-text { display:flex; flex-direction:column; justify-content:center; }
.pg-hdr-title {
    font-size:var(--fs-lg); font-weight:700; color:var(--text);
    margin:0; padding:0; line-height:1.3;
}
.pg-hdr-sub {
    color:var(--muted); font-size:var(--fs-sm);
    margin:clamp(4px, 0.8vw, 8px) 0 0 0; line-height:1.55;
}

/* ══════════════════════════════════════════════════════════════════════════
   SECTION HEADERS — fluid
   ══════════════════════════════════════════════════════════════════════════ */
.section-badge {
    display:inline-flex; align-items:center; justify-content:center;
    background:var(--p); color:#fff; border-radius:50%;
    width:clamp(22px, 2.5vw, 26px); height:clamp(22px, 2.5vw, 26px);
    font-size:clamp(10px, 1.2vw, 12px); font-weight:700;
    margin-right:10px; flex-shrink:0;
}
.section-header {
    display:flex; align-items:center;
    font-size:var(--fs-md); font-weight:700; color:var(--text);
    margin:8px 0 6px 0;
}
.section-hint {
    color:var(--muted); font-size:var(--fs-sm);
    margin:0 0 clamp(12px, 2vw, 16px) 36px;
    line-height:1.55;
}

/* ══════════════════════════════════════════════════════════════════════════
   INTERACTIVE COMPONENTS
   ══════════════════════════════════════════════════════════════════════════ */

/* Expander */
div[data-testid="stExpander"] { margin-bottom:6px!important; }

/* File upload — responsive + accessible */
[data-testid="stFileUploaderDropzone"] {
    border-radius:var(--r12)!important;
    border:2px dashed #c4b8d5!important;
    background:#fbf9fd!important;
    padding:clamp(14px, 2.5vw, 24px)!important;
    transition:border-color .2s,background .2s!important;
    min-height:clamp(80px, 10vw, 120px)!important;
}
[data-testid="stFileUploaderDropzone"]:hover {
    border-color:var(--p)!important; background:var(--p-light)!important;
}
[data-testid="stFileUploaderDropzone"]:focus-within {
    outline:3px solid var(--p)!important; outline-offset:2px!important;
    border-color:var(--p)!important;
}

/* Text inputs */
[data-testid="stTextInput"] input {
    border-radius:var(--r6)!important; min-height:44px!important;
    font-size:var(--fs-base)!important;
    transition:border-color .15s, box-shadow .15s!important;
}
[data-testid="stTextInput"] input:focus {
    border-color:var(--p)!important; box-shadow:0 0 0 3px var(--p-ring)!important;
    outline:none!important;
}
[data-testid="stDateInput"] input {
    border-radius:var(--r6)!important; min-height:44px!important;
    font-size:var(--fs-base)!important;
}
[data-testid="stDateInput"] input:focus {
    border-color:var(--p)!important; box-shadow:0 0 0 3px var(--p-ring)!important;
}

/* Select/dropdown focus */
[data-testid="stSelectbox"] select:focus,
[data-baseweb="select"]:focus-within [data-baseweb="input"] {
    border-color:var(--p)!important; box-shadow:0 0 0 3px var(--p-ring)!important;
}

/* Checkbox / radio accessible focus */
[data-testid="stCheckbox"] input:focus-visible + span,
[data-testid="stRadio"] input:focus-visible + span {
    outline:3px solid var(--p)!important; outline-offset:2px!important;
    border-radius:3px!important;
}

/* Primary CTA buttons */
[data-testid="stMain"] .stButton > button[kind="primary"] {
    background:var(--p)!important; border:2px solid var(--p)!important;
    color:#fff!important; border-radius:var(--r6)!important;
    font-weight:600!important; min-height:44px!important; letter-spacing:.2px!important;
    font-size:var(--fs-base)!important;
    transition:background .15s, box-shadow .15s, transform .1s!important;
    touch-action:manipulation!important;
}
[data-testid="stMain"] .stButton > button[kind="primary"]:hover {
    background:var(--p-dark)!important; box-shadow:0 4px 14px var(--p-ring)!important;
    transform:translateY(-1px)!important;
}
[data-testid="stMain"] .stButton > button[kind="primary"]:active {
    transform:translateY(0)!important;
}
[data-testid="stMain"] .stButton > button[kind="primary"]:focus-visible {
    outline:3px solid var(--p)!important; outline-offset:3px!important;
}

/* Primary download buttons */
[data-testid="stMain"] .stDownloadButton > button[kind="primary"] {
    background:var(--p)!important; border:2px solid var(--p)!important;
    color:#fff!important; border-radius:var(--r6)!important;
    font-weight:600!important; min-height:44px!important;
    font-size:var(--fs-base)!important;
    transition:background .15s, box-shadow .15s, transform .1s!important;
    touch-action:manipulation!important;
}
[data-testid="stMain"] .stDownloadButton > button[kind="primary"]:hover {
    background:var(--p-dark)!important; box-shadow:0 4px 14px var(--p-ring)!important;
    transform:translateY(-1px)!important;
}
[data-testid="stMain"] .stDownloadButton > button[kind="primary"]:active {
    transform:translateY(0)!important;
}
[data-testid="stMain"] .stDownloadButton > button[kind="primary"]:focus-visible {
    outline:3px solid var(--p)!important; outline-offset:3px!important;
}

/* Secondary buttons */
[data-testid="stMain"] .stButton > button[kind="secondary"] {
    border-radius:var(--r6)!important; font-weight:500!important;
    min-height:44px!important; font-size:var(--fs-base)!important;
    transition:background .15s, border-color .15s, color .15s!important;
    touch-action:manipulation!important;
}
[data-testid="stMain"] .stButton > button[kind="secondary"]:focus-visible {
    outline:3px solid var(--p)!important; outline-offset:3px!important;
}

/* Dividers */
hr { border-color:#e8e3f0!important; margin:clamp(16px, 2.5vw, 28px) 0!important; }

/* Responsive Streamlit columns — stack on very narrow viewports */
@media (max-width:480px) {
    [data-testid="stHorizontalBlock"] {
        flex-wrap:wrap!important;
    }
    [data-testid="stHorizontalBlock"] > [data-testid="stColumn"] {
        min-width:100%!important; flex:1 1 100%!important;
    }
}

/* ══════════════════════════════════════════════════════════════════════════
   SPACING / LAYOUT FIXES
   ══════════════════════════════════════════════════════════════════════════ */
/* Hide file-size limit text */
[data-testid="stFileUploaderDropzoneInstructions"] small,
[data-testid="stFileUploaderDropzoneInstructions"] div > small,
[data-testid="stFileUploaderDropzone"] small,
section[class*="uploadDropzone"] small { display:none!important; }

/* ══════════════════════════════════════════════════════════════════════════
   VALIDATION — inline errors + summary card
   ══════════════════════════════════════════════════════════════════════════ */
.field-err {
    display:flex; align-items:center; gap:6px;
    color:var(--err); font-size:var(--fs-sm); font-weight:500;
    margin:6px 0 10px 0;
    animation:fadeInDown .2s ease!important;
}
.field-err .material-icons-round { font-size:15px!important; flex-shrink:0; }

.req { color:var(--err); font-weight:700; margin-left:3px; }

.upload-err [data-testid="stFileUploaderDropzone"] {
    border-color:var(--err)!important; background:var(--err-bg)!important;
}

.val-card {
    display:flex; gap:clamp(8px, 1.5vw, 14px); align-items:flex-start;
    background:var(--err-bg); border:1px solid #ef9a9a;
    border-left:4px solid var(--err); border-radius:var(--r8);
    padding:clamp(10px, 2vw, 16px) clamp(12px, 2.5vw, 20px);
    margin:16px 0 12px 0;
    animation:fadeInDown .25s ease!important;
}
.val-card .material-icons-round { color:var(--err); font-size:clamp(18px,2.5vw,22px)!important; flex-shrink:0; margin-top:1px; }
.val-card-body { flex:1; min-width:0; }
.val-card-title { font-size:var(--fs-sm); font-weight:700; color:var(--err); margin:0 0 6px 0; }
.val-card-list  { margin:0; padding-left:18px; color:var(--err); font-size:var(--fs-sm); line-height:1.7; }

.ok-card {
    display:flex; gap:clamp(8px, 1.5vw, 14px); align-items:flex-start;
    background:var(--ok-bg); border:1px solid #a5d6a7;
    border-left:4px solid var(--ok); border-radius:var(--r8);
    padding:clamp(10px, 2vw, 16px) clamp(12px, 2.5vw, 20px);
    margin:0 0 12px 0;
}
.ok-card .material-icons-round { color:var(--ok); font-size:clamp(18px,2.5vw,22px)!important; flex-shrink:0; margin-top:1px; }

/* ── Fade-in animation for dynamic elements ──────────────────────────────── */
@keyframes fadeInDown {
    from { opacity:0; transform:translateY(-6px); }
    to   { opacity:1; transform:translateY(0); }
}
@keyframes fadeIn {
    from { opacity:0; }
    to   { opacity:1; }
}

/* ══════════════════════════════════════════════════════════════════════════
   FIXED TOP APP BAR
   ══════════════════════════════════════════════════════════════════════════ */
.app-bar {
    position:fixed; top:0; left:0; right:0; z-index:1200;
    height:56px;
    background:#ffffff;
    border-bottom:1px solid #ece6f5;
    box-shadow:0 2px 16px rgba(64,15,97,.10), 0 1px 4px rgba(0,0,0,.06);
    display:flex; align-items:center;
    padding:0 clamp(16px, 3vw, 32px);
    gap:14px;
    backdrop-filter:blur(8px);
    -webkit-backdrop-filter:blur(8px);
}
.app-bar-mark {
    width:36px; height:36px; border-radius:9px; flex-shrink:0;
    background:var(--p); color:#fff;
    display:flex; align-items:center; justify-content:center;
    font-size:12px; font-weight:800; letter-spacing:.3px;
    box-shadow:0 2px 8px var(--p-ring);
}
.app-bar-divider {
    width:1px; height:22px; background:#e0dae8; flex-shrink:0; margin:0 4px;
}
.app-bar-title {
    font-size:clamp(14px,1.5vw,16px); font-weight:700;
    color:var(--text); letter-spacing:-.2px; line-height:1;
}
.app-bar-sub {
    font-size:clamp(10px,1vw,11.5px); color:var(--muted);
    font-weight:400; margin-top:2px; line-height:1;
}
.app-bar-text { display:flex; flex-direction:column; }
.app-bar-step {
    margin-left:auto; display:flex; align-items:center; gap:6px;
    font-size:12px; font-weight:600; color:var(--p);
    background:var(--p-light); padding:5px 12px; border-radius:20px;
}
.app-bar-step .material-icons-round { font-size:14px!important; }

/* ── App shell — full-screen flex column, no overflow ───────────────────── */
[data-testid="stApp"] {
    padding-top:56px!important;
    height:100vh!important;
    overflow:hidden!important;
    display:flex!important;
    flex-direction:column!important;
}

/* ── View container — fills remaining space, single flex row ────────────── */
[data-testid="stAppViewContainer"] {
    display:flex!important;
    flex-direction:row!important;
    align-items:stretch!important;        /* both columns fill full height  */
    flex:1 1 0%!important;
    height:calc(100vh - 56px)!important;  /* fixed height, not min-height   */
    overflow:hidden!important;            /* no container-level scroll      */
    min-height:0!important;
}

/* ── Main content — sole scroll owner for page content ──────────────────── */
[data-testid="stMain"] {
    flex:1 1 0%!important;
    min-width:0!important;
    min-height:0!important;
    height:100%!important;
    overflow-y:auto!important;
    overflow-x:hidden!important;
    scrollbar-width:thin!important;
    scrollbar-color:rgba(64,15,97,.25) transparent!important;
}
[data-testid="stMain"]::-webkit-scrollbar { width:6px!important; }
[data-testid="stMain"]::-webkit-scrollbar-track { background:transparent!important; }
[data-testid="stMain"]::-webkit-scrollbar-thumb {
    background:rgba(64,15,97,.25)!important; border-radius:3px!important;
}
[data-testid="stMain"]::-webkit-scrollbar-thumb:hover {
    background:rgba(64,15,97,.45)!important;
}


/* ══════════════════════════════════════════════════════════════════════════
   SIDEBAR TOGGLE — bottom placement
   ─────────────────────────────────────────────────────────────────────────
   COLLAPSE bar  → full-width, fixed at bottom of the sidebar panel.
                   JS sets left + width to match sidebar rect each frame.
   EXPAND tab    → fixed bottom-left tab; appears when sidebar collapses.
   Both are real native buttons → isTrusted:true clicks, React works.
   ══════════════════════════════════════════════════════════════════════════ */

/* ── Shared reset ────────────────────────────────────────────────────────── */
[data-testid="stSidebarHeader"] button,
[data-testid="collapsedControl"] button,
[data-testid="stSidebarCollapsedControl"] button {
    width:100%!important; height:100%!important;
    background:transparent!important; border:none!important;
    cursor:pointer!important; padding:0!important;
    display:flex!important; align-items:center!important; justify-content:center!important;
    color:#5b2d8e!important;
}
[data-testid="stSidebarHeader"] button svg,
[data-testid="collapsedControl"] svg,
[data-testid="stSidebarCollapsedControl"] svg {
    width:14px!important; height:14px!important; flex-shrink:0!important;
}

/* ── COLLAPSE — full-width bar at sidebar bottom; JS sets left + width ───── */
[data-testid="stSidebarHeader"] {
    position:fixed!important;
    bottom:0!important;
    /* left + width set by JS */
    height:44px!important;
    background:#f5eefa!important;
    border-top:1px solid #e0d8f0!important;
    border-right:none!important;
    box-shadow:0 -2px 8px rgba(64,15,97,.07)!important;
    display:flex!important; align-items:center!important; justify-content:center!important;
    cursor:pointer!important;
    z-index:1200!important;
    padding:0!important; margin:0!important;
    transition:background .2s ease!important;
}
[data-testid="stSidebarHeader"]:hover { background:#ecdff8!important; }
section[data-testid="stSidebar"][aria-expanded="false"] [data-testid="stSidebarHeader"] {
    display:none!important;
}

/* ── EXPAND — small tab at bottom-left when sidebar is collapsed ─────────── */
[data-testid="collapsedControl"],
[data-testid="stSidebarCollapsedControl"] {
    position:fixed!important;
    bottom:0!important;
    left:0!important;
    width:44px!important; height:44px!important;
    background:#f5eefa!important;
    border-top:1px solid #e0d8f0!important;
    border-right:1px solid #e0d8f0!important;
    border-radius:0 8px 0 0!important;
    box-shadow:2px -2px 8px rgba(64,15,97,.07)!important;
    display:flex!important; align-items:center!important; justify-content:center!important;
    cursor:pointer!important;
    z-index:1200!important;
    padding:0!important; margin:0!important;
    transition:background .2s ease!important;
}
[data-testid="collapsedControl"]:hover,
[data-testid="stSidebarCollapsedControl"]:hover { background:#ecdff8!important; }

/* Style Streamlit's own toolbar/header to sit under ours */
header[data-testid="stHeader"] {
    top:56px!important;
    box-shadow:none!important;
    border-bottom:none!important;
    background:transparent!important;
}

/* ══════════════════════════════════════════════════════════════════════════
   PAGE HEADER — card with shadow
   ══════════════════════════════════════════════════════════════════════════ */
.pg-hdr {
    background:linear-gradient(135deg,#fbf8ff 0%,#ffffff 60%)!important;
    border:1px solid #ece6f5!important;
    border-radius:var(--r12)!important;
    box-shadow:0 2px 12px rgba(64,15,97,.07), 0 1px 3px rgba(0,0,0,.04)!important;
    padding:clamp(14px,2.5vw,22px) clamp(16px,3vw,28px)!important;
    margin-bottom:clamp(16px,2.5vw,28px)!important;
    border-bottom:none!important;
}


/* ══════════════════════════════════════════════════════════════════════════
   JE PREVIEW — dynamic table fills viewport height
   ══════════════════════════════════════════════════════════════════════════ */
/* The outer wrapper Streamlit creates for st.data_editor */
[data-testid="stDataEditorGridContainer"],
[data-testid="stDataEditor"] > div:first-child {
    height:100%!important;
}

/* ── Print — hide nav chrome, show only content ──────────────────────────── */
@media print {
    section[data-testid="stSidebar"] { display:none!important; }
    .mstepper { display:none!important; }
    .app-bar { display:none!important; }
    [data-testid="stApp"] { padding-top:0!important; }
    section[data-testid="stSidebar"] { top:0!important; height:100vh!important; }
    .pg-hdr { box-shadow:none!important; border:1px solid #ccc!important; }
    [data-testid="stMain"] .stButton,
    [data-testid="stMain"] .stDownloadButton { display:none!important; }
}

/* ── Reduced motion — respect user OS preference ─────────────────────────── */
@media (prefers-reduced-motion:reduce) {
    *, *::before, *::after {
        animation-duration:.01ms!important; animation-iteration-count:1!important;
        transition-duration:.01ms!important;
    }
}

</style>
""", unsafe_allow_html=True)

init_session_state()
st.markdown('<a class="skip-link" href="#main-content">Skip to main content</a>', unsafe_allow_html=True)

# ---------------------------------------------------------------------------
# Fixed top app bar — persists across all steps
# ---------------------------------------------------------------------------
_step_labels = {1: "Generate JE", 2: "JE Preview", 3: "Edit Mapping", 4: "QuickBooks", 5: "Activity Log"}
_step_icons  = {1: "edit_document", 2: "table_view", 3: "edit_note", 4: "cloud_sync", 5: "history"}
_cur_step    = st.session_state.get("step", 1)
_bar_step_lbl = _step_labels.get(_cur_step, "")
_bar_step_ico = _step_icons.get(_cur_step, "arrow_forward")
st.markdown(f"""
<header class="app-bar" role="banner" aria-label="Payroll JE Automation">
  <div class="app-bar-mark" aria-hidden="true">PJ</div>
  <div class="app-bar-text">
    <span class="app-bar-title">Payroll JE Automation</span>
    <span class="app-bar-sub">QuickBooks Journal Entry Generator</span>
  </div>
  <div class="app-bar-divider" aria-hidden="true"></div>
  <div class="app-bar-step" aria-label="Current step: {_bar_step_lbl}">
    <span class="material-icons-round" aria-hidden="true">{_bar_step_ico}</span>
    Step {_cur_step} · {_bar_step_lbl}
  </div>
</header>
""", unsafe_allow_html=True)
st.components.v1.html("""
<script>
(function () {
    var doc = window.parent.document;

    /* ── Responsive breakpoint stamp ──────────────────────────────────────
       Sets  data-bp="xs|sm|md|lg"  on <body> so media queries and CSS
       attribute selectors both work. Re-runs on every resize.               */
    function stampBreakpoint() {
        var w = window.parent.innerWidth;
        var bp = w < 480 ? 'xs' : w < 768 ? 'sm' : w < 1024 ? 'md' : 'lg';
        if (doc.body.getAttribute('data-bp') !== bp) {
            doc.body.setAttribute('data-bp', bp);
        }
        /* Stamp screen height so Python can read it on next rerun via query param */
        doc.body.setAttribute('data-screen-h', String(window.parent.innerHeight));
    }

    /* ── Fluid sidebar width ──────────────────────────────────────────────
       On medium screens narrow the sidebar slightly; on small screens let
       Streamlit's own collapse behaviour handle it.                         */
    function tuneLayout() {
        var w = window.parent.innerWidth;
        var sidebar = doc.querySelector('section[data-testid="stSidebar"]');
        if (!sidebar) return;
        if (w >= 1280) {
            sidebar.style.setProperty('--sidebar-width', '288px');
        } else if (w >= 1024) {
            sidebar.style.setProperty('--sidebar-width', '260px');
        }
        /* On narrow screens Streamlit auto-hides — nothing to force */
    }

    /* ── Smooth page-content fade on step transitions ─────────────────────
       Adds a brief fade-in to the main block container on each rerun.       */
    function animateMain() {
        var main = doc.querySelector('[data-testid="stAppViewBlockContainer"]');
        if (!main) return;
        main.style.animation = 'none';
        /* Force reflow */
        void main.offsetHeight;
        main.style.animation = 'fadeIn .18s ease';
    }

    /* ── Run on load ─────────────────────────────────────────────────────── */
    stampBreakpoint();
    tuneLayout();
    animateMain();

    /* ── Re-run on resize ────────────────────────────────────────────────── */
    window.parent.addEventListener('resize', function () {
        stampBreakpoint();
        tuneLayout();
    }, { passive: true });

    /* ── Re-animate main on Streamlit reruns ─────────────────────────────── */
    /* Watch only childList (NOT attributes/style) to avoid cascade loops    */
    var _lastMain = null;
    new MutationObserver(function () {
        var main = doc.querySelector('[data-testid="stAppViewBlockContainer"]');
        if (main && main !== _lastMain) {
            _lastMain = main;
            window.parent.requestAnimationFrame(animateMain);
        }
    }).observe(doc.body, { childList: true, subtree: false });

    /* ── Sidebar bottom toggle ───────────────────────────────────────────────
       stSidebarHeader (collapse bar) is position:fixed at bottom.
       JS sets its left + width each frame to match the sidebar's rect so it
       always spans exactly the sidebar width.
       collapsedControl (expand tab) is CSS-fixed at bottom:0 left:0 — no JS. */
    (function () {
        function sidebar() { return doc.querySelector('section[data-testid="stSidebar"]'); }

        function syncCollapseBar() {
            var hdr = doc.querySelector('[data-testid="stSidebarHeader"]');
            if (!hdr) return;
            var s = sidebar();
            if (!s) return;
            var r = s.getBoundingClientRect();
            hdr.style.left  = Math.round(r.left)  + 'px';
            hdr.style.width = Math.round(r.width) + 'px';
        }

        function trackTransition() {
            var n = 0;
            (function tick() {
                syncCollapseBar();
                if (++n < 25) window.parent.requestAnimationFrame(tick);
            })();
        }

        function attachObserver() {
            var s = sidebar();
            if (!s || s._pjObs) return;
            s._pjObs = true;
            new MutationObserver(trackTransition)
                .observe(s, { attributes: true, attributeFilter: ['aria-expanded', 'style'] });
        }

        new MutationObserver(function () { syncCollapseBar(); attachObserver(); })
            .observe(doc.body, { childList: true, subtree: false });

        window.parent.addEventListener('resize', syncCollapseBar, { passive: true });

        attachObserver();
        syncCollapseBar();
        [50, 150, 350, 700].forEach(function (d) { setTimeout(syncCollapseBar, d); });
    })();
})();
</script>
""", height=0)

from views.step1_generate   import render as _r1
from views.step2_preview    import render as _r2
from views.step3_mapping    import render as _r3
from views.step4_quickbooks import render as _r4
from views.step5_activity_log import render as _r5

_pages = {
    1: st.Page(_r1, title="Generate JE",  url_path="generate-je",  default=True),
    2: st.Page(_r2, title="JE Preview",   url_path="je-preview"),
    3: st.Page(_r3, title="Edit Mapping", url_path="edit-mapping"),
    4: st.Page(_r4, title="QuickBooks",   url_path="quickbooks"),
    5: st.Page(_r5, title="Activity Log", url_path="activity-log"),
}
st.session_state["_pages"] = _pages

_pg = st.navigation(list(_pages.values()), position="hidden")

# Sync session_state["step"] from the current URL so sidebar highlights correctly
_url_to_step = {v: k for k, v in _pages.items()}
st.session_state["step"] = _url_to_step[_pg]

render_sidebar()
_pg.run()
