export const STYLE_CSS = String.raw`:root{--bg:#14110f;--fg:#f2ebdd;--muted:#a99f90;--line:#2f2823;--line2:#4a4038;--accent:#ef4444;--card:#1b1714;--ok:#86efac;--warn:#fca5a5}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow-wrap:break-word}
.wrap{max-width:760px;margin:0 auto;padding:0 16px}
.sim{background:var(--accent);color:#14110f;padding:10px 0;font-size:.95rem;text-align:center}
.top{border-bottom:1px solid var(--line);padding:16px 0}
.top .wrap{display:flex;justify-content:space-between;align-items:center;gap:16px}
h1{margin:0;font-size:1.5rem}
h2{margin:0 0 12px;font-size:1.25rem}
h3{margin:16px 0 8px;font-size:1rem}
.muted{color:var(--muted)}
.small{font-size:.85rem}
.lang{display:flex;gap:8px;flex-shrink:0}
.lang button{min-width:44px;padding:0 12px;font-weight:600}
.lang button[aria-pressed=true],.tabs button[aria-pressed=true]{border-color:var(--accent);background:var(--card)}
.intro{padding-top:20px;padding-bottom:8px}
.intro p{margin:0 0 12px}
.intro ul{margin:0 0 16px;padding-left:20px}
.intro li{margin-bottom:4px}
.tabs{display:flex;gap:8px;margin:8px 0 12px}
.tabs button{flex:1}
.count{color:var(--muted);font-weight:400}
.demo{max-width:1200px;margin:0 auto;padding:0 16px}
.demo[data-view=shop] #col-back{display:none}
.demo[data-view=backstage] #col-shop{display:none}
.col{min-width:0}
.steps{display:flex;gap:8px;list-style:none;padding:0;margin:0 0 16px;flex-wrap:wrap}
.steps li{border:1px solid var(--line);border-radius:999px;padding:4px 12px;color:var(--muted);font-size:.9rem}
.steps li.active{border-color:var(--accent);color:var(--fg)}
.steps li.done{color:var(--fg);border-color:var(--line2)}
.guide{border-left:3px solid var(--accent);background:var(--card);padding:10px 12px;margin:0 0 16px;border-radius:0 8px 8px 0}
.guide p{margin:0 0 8px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:12px;min-width:0}
.card h3:first-child{margin-top:0}
.row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--line)}
.row:last-child{border-bottom:0}
.row .grow{flex:1;min-width:0}
.price{font-variant-numeric:tabular-nums;white-space:nowrap}
button,input,select{font:inherit;color:var(--fg);background:var(--bg);border:1px solid var(--line2);border-radius:8px;padding:10px 14px;min-height:44px;max-width:100%}
button{cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:#14110f;font-weight:600}
button:disabled{opacity:.5;cursor:not-allowed}
button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
input[type=number]{width:72px}
input[type=text]{width:100%}
.inline input[type=text]{width:auto;min-width:0}
label.opt{display:flex;gap:12px;align-items:flex-start;padding:10px;min-height:44px;border:1px solid var(--line);border-radius:8px;margin-bottom:8px;cursor:pointer}
label.opt input{min-height:0;width:20px;height:20px;margin:2px 0 0;flex-shrink:0}
label.opt.sel{border-color:var(--accent)}
.fields{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}
.fields .wide{grid-column:1/-1}
.fields label{display:block;font-size:.9rem;color:var(--muted);margin-bottom:2px}
.samples{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.error{color:var(--warn);border:1px solid var(--accent);border-radius:8px;padding:10px;margin:12px 0}
.badge{display:inline-block;border:1px solid var(--line2);border-radius:6px;padding:2px 8px;font-size:.85rem}
.badge.ok{border-color:#4ade80;color:var(--ok)}
.badge.bad{border-color:var(--accent);color:var(--warn)}
pre{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px;font-size:.8rem;margin:8px 0 0;max-width:100%}
.tablewrap{overflow-x:auto;max-width:100%}
table{border-collapse:collapse;width:100%;font-size:.85rem;font-variant-numeric:tabular-nums}
th,td{padding:6px 4px;text-align:right;border-bottom:1px solid var(--line)}
th:first-child,td:first-child{text-align:left}
th{color:var(--muted);font-weight:600}
.timeline{margin:0;padding-left:20px;color:var(--muted);font-size:.9rem}
.rel{border:1px solid var(--line2);border-radius:8px;padding:10px;margin-bottom:8px}
.rel p{margin:6px 0 0}
.result{margin:8px 0 0;color:var(--ok)}
.log{list-style:none;margin:0;padding:0}
.log li{border-left:2px solid var(--line2);padding:2px 0 10px 12px;margin-left:4px}
.log time{color:var(--muted);font-size:.8rem;font-variant-numeric:tabular-nums}
.log p{margin:0}
.log details{margin-top:4px}
.log summary{cursor:pointer;color:var(--muted);font-size:.85rem;min-height:44px;display:flex;align-items:center}
.cta{margin-top:24px}
.cta p{border:1px solid var(--line2);border-radius:12px;padding:16px;margin:0}
.cta a{color:var(--fg);font-weight:600;text-underline-offset:3px;display:inline-flex;align-items:center;min-height:44px}
footer.small{padding:24px 16px}
.only-mobile{display:inline-flex}
@media (min-width:900px){
  .tabs,.only-mobile{display:none}
  .demo[data-view=shop] #col-back,.demo[data-view=backstage] #col-shop{display:block}
  .demo{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:32px}
}
.sr-only{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}

/* Loading states and small animations. Everything below is switched off or simplified for reduced motion. */
.spinner{display:inline-block;width:1em;height:1em;margin-right:.5em;vertical-align:-.15em;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:spin .8s linear infinite}
button[aria-busy=true]{opacity:.85;cursor:progress}
.waiting{display:flex;align-items:center;gap:0;margin:0 0 8px}
.waiting .spinner{width:1.1em;height:1.1em;flex-shrink:0}
p.waiting{font-size:1rem;font-weight:400}
.steps li{transition:border-color .3s ease,color .3s ease,background-color .3s ease}
.steps li.active{background:var(--card)}
.totals{position:relative;transition:opacity .2s ease}
.totals.pending{opacity:.6}
.totals.pending::after{content:"";position:absolute;top:12px;right:12px;width:14px;height:14px;border:2px solid var(--muted);border-right-color:transparent;border-radius:50%;animation:spin .8s linear infinite}
.badge.pop{animation:pop .45s ease}
.outcome{display:flex;align-items:center;gap:12px;min-height:44px;padding:10px 12px;border:1px solid var(--line2);border-radius:8px;margin-bottom:12px}
.outcome.ok{border-color:#4ade80;color:var(--ok)}
.outcome.bad{border-color:var(--accent);color:var(--warn)}
.outcome.bad.fx{animation:shake .45s ease}
.outcome .cross{font-size:1.6rem;line-height:1;width:28px;text-align:center;flex-shrink:0}
.check{width:28px;height:28px;flex-shrink:0;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.outcome.fx .check circle{stroke-dasharray:63;stroke-dashoffset:63;animation:draw .5s ease forwards}
.outcome.fx .check path{stroke-dasharray:20;stroke-dashoffset:20;animation:draw .35s ease .4s forwards}
.log li.new{animation:slide-in .35s ease}
.log li.latest p{animation:glow 1.8s ease-out}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes draw{to{stroke-dashoffset:0}}
@keyframes pop{0%{transform:scale(.8);opacity:.4}60%{transform:scale(1.12)}100%{transform:scale(1);opacity:1}}
@keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-6px)}40%{transform:translateX(6px)}60%{transform:translateX(-4px)}80%{transform:translateX(3px)}}
@keyframes slide-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
@keyframes glow{from{background:rgba(239,68,68,.25)}to{background:transparent}}
@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}
  .spinner{border-right-color:currentColor;border-style:dotted}
  .outcome.fx .check circle,.outcome.fx .check path{stroke-dasharray:none;stroke-dashoffset:0}
  .log li.latest p{background:rgba(239,68,68,.15)}
}
`;
