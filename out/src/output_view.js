/*  Author:     Denis Paluca, TU Muenchen

Isabelle output panel as web view.
*/
'use strict';
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.Output_View_Provider = void 0;
exports.get_webview_html = get_webview_html;
exports.open_webview_link = open_webview_link;
const vscode_1 = require("vscode");
const decorations_1 = require("./decorations");
const vscode_lib = __importStar(require("./vscode_lib"));
const path = __importStar(require("path"));
const lsp = __importStar(require("./lsp"));
const symbol_converter_1 = require("./symbol_converter");
class Output_View_Provider {
    constructor(_extension_uri, _language_client) {
        this._extension_uri = _extension_uri;
        this._language_client = _language_client;
        this.content = '';
        this.proofState = '';
        this.lastProofStateTime = 0;
        this.symbolConverter = new symbol_converter_1.SymbolConverter(this._extension_uri.fsPath);
    }
    async resolveWebviewView(view, context, _token) {
        this._view = view;
        view.webview.options = {
            // Allow scripts in the webview
            enableScripts: true,
            localResourceRoots: [
                this._extension_uri
            ]
        };
        // Convert symbols in initial content if any
        const convertedContent = await this.symbolConverter.convertSymbols(this.content);
        const convertedProofState = await this.symbolConverter.convertSymbols(this.proofState);
        const { normalProofState, autoProofState } = this.splitProofState(convertedProofState);
        view.webview.html = this._get_html(convertedContent, normalProofState, autoProofState);
        view.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case "open":
                    open_webview_link(message.link);
                    break;
                case "resize":
                    this._language_client.sendNotification(lsp.output_set_margin_type, { margin: message.margin });
                    break;
            }
        });
    }
    async update_content(content) {
        console.log('=== update_content called ===');
        console.log('Raw content:', content);
        // Extract main content and proof state from the raw content
        const { mainContent, proofState } = this.extractContentAndProofState(content);
        console.log('Extracted main content:', mainContent);
        console.log('Extracted proof state:', proofState);
        // Convert Isabelle symbols to Unicode
        const convertedContent = await this.symbolConverter.convertSymbols(mainContent);
        const convertedProofState = await this.symbolConverter.convertSymbols(proofState);
        // Split proof state into normal and auto sections
        const { normalProofState, autoProofState } = this.splitProofState(convertedProofState);
        console.log('Normal proof state:', normalProofState);
        console.log('Auto proof state:', autoProofState);
        if (!this._view) {
            this.content = convertedContent;
            this.proofState = convertedProofState;
            return;
        }
        this.content = convertedContent;
        this.proofState = convertedProofState;
        if (convertedProofState) {
            this.lastProofStateTime = Date.now();
        }
        this._view.webview.html = this._get_html(convertedContent, normalProofState, autoProofState);
    }
    async update_proof_state(stateContent) {
        console.log('=== update_proof_state called ===');
        console.log('Raw stateContent:', stateContent);
        // Convert Isabelle symbols to Unicode
        const convertedProofState = await this.symbolConverter.convertSymbols(stateContent);
        console.log('Converted proof state:', convertedProofState);
        // Split proof state into normal and automation sections
        const { normalProofState, autoProofState } = this.splitProofState(convertedProofState);
        console.log('Normal proof state:', normalProofState);
        console.log('Auto proof state:', autoProofState);
        this.proofState = convertedProofState;
        this.lastProofStateTime = Date.now();
        if (!this._view) {
            console.log('No view available');
            return;
        }
        this._view.webview.html = this._get_html(this.content, normalProofState, autoProofState);
        console.log('=== HTML updated ===');
    }
    extractContentAndProofState(rawContent) {
        if (!rawContent || rawContent.trim().length === 0) {
            return { mainContent: '', proofState: '' };
        }
        const lines = rawContent.split('\n');
        let proofStateStartIndex = -1;
        // Find the start of proof state (look for "proof (prove)" or "goal (")
        for (let i = 0; i < lines.length; i++) {
            const trimmedLine = lines[i].trim();
            if (trimmedLine.startsWith('proof (prove)') || trimmedLine.startsWith('goal (')) {
                proofStateStartIndex = i;
                break;
            }
        }
        // If no proof state found, return all as main content
        if (proofStateStartIndex === -1) {
            return { mainContent: rawContent, proofState: '' };
        }
        // Split into main content and proof state
        const mainLines = lines.slice(0, proofStateStartIndex);
        const proofLines = lines.slice(proofStateStartIndex);
        return {
            mainContent: mainLines.join('\n').trim(),
            proofState: proofLines.join('\n').trim()
        };
    }
    splitProofState(proofState) {
        if (!proofState) {
            return { normalProofState: '', autoProofState: '' };
        }
        const lines = proofState.split('\n');
        let autoStartIndex = -1;
        // Find the first line that starts with "Auto"
        for (let i = 0; i < lines.length; i++) {
            const trimmedLine = lines[i].trim();
            if (trimmedLine.startsWith('Auto')) {
                autoStartIndex = i;
                break;
            }
        }
        // If no "Auto" line found, return all as normal proof state
        if (autoStartIndex === -1) {
            return { normalProofState: proofState, autoProofState: '' };
        }
        // Split into normal and auto sections
        const normalLines = lines.slice(0, autoStartIndex);
        const autoLines = lines.slice(autoStartIndex);
        return {
            normalProofState: normalLines.join('\n').trim(),
            autoProofState: autoLines.join('\n').trim()
        };
    }
    async clear_proof_state() {
        this.proofState = '';
        if (!this._view) {
            return;
        }
        this._view.webview.html = this._get_html(this.content, '');
    }
    async check_and_clear_old_proof_state(maxAgeMs = 2000) {
        if (this.proofState && this.lastProofStateTime > 0) {
            const age = Date.now() - this.lastProofStateTime;
            if (age > maxAgeMs) {
                await this.clear_proof_state();
            }
        }
    }
    _get_html(content, normalProofState = '', autoProofState = '') {
        if (this._view?.webview) {
            return get_webview_html(content, normalProofState, autoProofState, this._view.webview, this._extension_uri.fsPath);
        }
        return "";
    }
}
exports.Output_View_Provider = Output_View_Provider;
Output_View_Provider.view_type = 'isabelle-output';
function open_webview_link(link) {
    const uri = vscode_1.Uri.parse(link);
    const line = Number(uri.fragment) || 0;
    const pos = new vscode_1.Position(line, 0);
    vscode_1.window.showTextDocument(uri.with({ fragment: '' }), {
        preserveFocus: false,
        selection: new vscode_1.Selection(pos, pos)
    });
}
function get_webview_html(content, normalProofState, autoProofState, webview, extension_path) {
    const script_uri = webview.asWebviewUri(vscode_1.Uri.file(path.join(extension_path, 'media', 'main.js')));
    const css_uri = webview.asWebviewUri(vscode_1.Uri.file(path.join(extension_path, 'media', 'vscode.css')));
    const font_uri = webview.asWebviewUri(vscode_1.Uri.file(path.join(extension_path, 'fonts', 'IsabelleDejaVuSansMono.ttf')));
    // Prepare main content section
    const mainSection = content ? `
    <div class="content-section main-content">
      ${content.trim().startsWith('<pre') ? content : `<pre>${content}</pre>`}
    </div>` : '';
    // Prepare normal proof state section (green background)
    const normalProofSection = normalProofState ? `
    <div class="content-section proof-state-normal">
      ${normalProofState.trim().startsWith('<pre') ? normalProofState : `<pre>${normalProofState}</pre>`}
    </div>` : '';
    // Prepare auto proof state section (blue background)
    const autoProofSection = autoProofState ? `
    <div class="content-section proof-state-auto">
      ${autoProofState.trim().startsWith('<pre') ? autoProofState : `<pre>${autoProofState}</pre>`}
    </div>` : '';
    return `<!DOCTYPE html>
    <html lang='en'>
      <head>
        <meta charset='UTF-8'>
        <meta name='viewport' content='width=device-width, initial-scale=1.0'>
        <link href='${css_uri}' rel='stylesheet' type='text/css'>
        <style>
            @font-face {
                font-family: "Isabelle DejaVu Sans Mono";
                src: url(${font_uri});
            }
            ${_get_decorations()}

            .content-section {
              margin: 5px 0;
              border-radius: 4px;
              padding: 8px;
            }

            .main-content {
              background-color: transparent;
            }

            .proof-state-normal {
              background-color: rgba(0, 128, 0, 0.1);
              border-left: 4px solid rgba(0, 128, 0, 0.6);
            }

            .proof-state-auto {
              background-color: rgba(0, 128, 255, 0.1);
              border-left: 4px solid rgba(0, 128, 255, 0.6);
            }

            .content-section pre {
              margin: 0;
              padding: 0;
              background: transparent;
              border: none;
            }

            /* Dark theme adjustments */
            body.vscode-dark .proof-state-normal {
              background-color: rgba(0, 255, 0, 0.08);
              border-left-color: rgba(0, 255, 0, 0.4);
            }

            body.vscode-dark .proof-state-auto {
              background-color: rgba(100, 150, 255, 0.08);
              border-left-color: rgba(100, 150, 255, 0.4);
            }
        </style>
        <title>Output</title>
      </head>
      <body>
        ${mainSection}
        ${normalProofSection}
        ${autoProofSection}
        <script src='${script_uri}'></script>
      </body>
    </html>`;
}
function _get_decorations() {
    let style = [];
    for (const key of decorations_1.text_colors) {
        style.push(`body.vscode-light .${key} { color: ${vscode_lib.get_color(key, true)} }\n`);
        style.push(`body.vscode-dark .${key} { color: ${vscode_lib.get_color(key, false)} }\n`);
    }
    return style.join("");
}
//# sourceMappingURL=output_view.js.map