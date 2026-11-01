export const COMPOSER_CSS = `
.cp-composer{border-radius:24px;padding:13px 12px 10px;box-shadow:0 2px 14px #00000006}
.cp-composer textarea{min-height:50px;resize:none;padding:0 3px 9px}
.cp-composer-row{gap:7px}
.cp-composer-menu{position:relative;min-width:0;flex:none}
.cp-approval-mode{border-radius:16px;background:var(--cp-soft);padding:4px 8px;font-size:12px!important;max-width:none;color:var(--cp-muted);height:27px;gap:5px;white-space:nowrap}
.cp-approval-mode:hover,.cp-approval-mode[aria-expanded=true]{background:var(--cp-hover);color:var(--cp-fg)}
.cp-composer-menu:has(.cp-model-button){flex-shrink:1}.cp-model-button{max-width:min(280px,100%);font-size:12px!important;padding:5px 4px;gap:5px}
.cp-model-name{overflow:hidden;text-overflow:ellipsis;min-width:0}.cp-effort-label{color:var(--cp-muted);flex:none}.cp-model-button>svg{flex:none;transform:rotate(0deg)}
.cp-composer-popover{top:auto;bottom:calc(100% + 10px);right:0;min-width:258px;width:280px;max-width:calc(100vw - 40px);padding:6px;border-radius:16px;box-shadow:0 4px 24px #00000014;z-index:25}
.cp-popover-left{left:0;right:auto}
.cp-composer-menu-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:3px 7px 7px;color:var(--cp-muted);font-size:12px;line-height:1.5}
.cp-composer-menu-heading>a{font-size:11px;color:inherit;white-space:nowrap;text-underline-offset:2px}
.cp-composer-popover button{display:flex;align-items:center;gap:9px;width:100%;background:none;border-radius:9px;padding:7px;font-size:13px!important;text-align:left;line-height:1.4}
.cp-composer-popover button:hover,.cp-composer-popover button:focus-visible{background:var(--cp-hover)}
.cp-composer-popover button>svg{flex:none}.cp-composer-popover button>svg:last-child{margin-left:auto}
.cp-composer-choice{min-width:0;flex:1;display:flex;flex-direction:column;gap:2px}.cp-composer-choice>strong{font-weight:450}.cp-composer-choice>small{font-size:11px;color:var(--cp-muted);line-height:1.5}
.cp-model-choices{max-height:240px;overflow:auto}.cp-composer-menu-divider{border-top:1px solid var(--cp-line);margin-top:5px;padding-top:9px}
.cp-effort-choices{display:flex;flex-wrap:wrap;gap:4px;padding:0 5px 4px}.cp-effort-choices>button{width:auto;justify-content:center;padding:5px 9px;font-size:12px!important}.cp-effort-choices>[aria-checked=true]{background:var(--cp-soft)}
.cp-composer-menu-note{font-size:11px;line-height:1.5;color:var(--cp-muted);margin:5px 7px}
.cp-composer-hint{margin:5px 0 8px}.cp-send{width:30px;height:30px}.cp-send svg{stroke-width:2}.cp-voice-active{color:light-dark(#b64141,#ff9999)!important;background:var(--cp-soft)}
.cp-voice-status{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--cp-muted);padding:3px 4px 10px}.cp-voice-status>span{flex:1}.cp-voice-error{color:light-dark(#a34444,#eeaaaa)}
@media(max-width:760px){.cp-composer-row{gap:4px}.cp-approval-mode{font-size:11px!important;padding:4px 6px}.cp-model-button{max-width:min(150px,100%);font-size:11px!important}.cp-composer-popover{width:270px;max-width:calc(100vw - 36px)}.cp-composer-menu:has(.cp-approval-mode)>.cp-popover-left{left:-38px}.cp-approval-mode{max-width:none}.cp-composer{border-radius:22px}}
`;
