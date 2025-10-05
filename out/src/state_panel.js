/*  Author:     Makarius

State panel via HTML webview inside VSCode.
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
exports.init = init;
exports.setup = setup;
const vscode_lib = __importStar(require("./vscode_lib"));
const lsp = __importStar(require("./lsp"));
const vscode_1 = require("vscode");
const output_view_1 = require("./output_view");
let language_client;
function panel_column() {
    const activeEditor = vscode_1.window.activeTextEditor;
    if (activeEditor) {
        return vscode_lib.adjacent_editor_column(activeEditor, true);
    }
    return vscode_1.ViewColumn.Two;
}
class Panel {
    get_id() { return this.state_id; }
    check_id(id) { return this.state_id === id; }
    set_content(state) {
        this.state_id = state.id;
        this.webview_panel.webview.html = this._get_html(state.content, state.auto_update);
    }
    reveal() {
        this.webview_panel.reveal(panel_column());
    }
    constructor(extension_path) {
        this.state_id = 0;
        this._extension_path = extension_path;
        this.webview_panel = vscode_1.window.createWebviewPanel("isabelle-state", "State", panel_column(), { enableScripts: true });
        this.webview_panel.onDidDispose(exit_panel);
        this.webview_panel.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case "auto_update":
                    language_client.sendNotification(lsp.state_auto_update_type, { id: this.state_id, enabled: message.enabled });
                    break;
                case "update":
                    language_client.sendNotification(lsp.state_update_type, { id: this.state_id });
                    break;
                case "locate":
                    language_client.sendNotification(lsp.state_locate_type, { id: this.state_id });
                    break;
                case "open":
                    (0, output_view_1.open_webview_link)(message.link);
                    break;
                case "resize":
                    language_client.sendNotification(lsp.state_set_margin_type, { id: this.state_id, margin: message.margin });
                    break;
                default:
                    break;
            }
        });
    }
    _get_html(content, auto_update) {
        const webview = this.webview_panel.webview;
        const checked = auto_update ? "checked" : "";
        const content_with_buttons = `<div id="controls">
      <input type="checkbox" id="auto_update" ${checked}/>
      <label for="auto_update">Auto update</label>
      <button id="update_button">Update</button>
      <button id="locate_button">Locate</button>
    </div>
    ${content}`;
        return (0, output_view_1.get_webview_html)(content_with_buttons, '', '', '', webview, this._extension_path);
    }
}
let panel = null;
function exit_panel() {
    if (panel) {
        language_client.sendNotification(lsp.state_exit_type, { id: panel.get_id() });
        panel = null;
    }
}
function init(uri) {
    if (language_client) {
        if (panel)
            panel.reveal();
        else
            language_client.sendRequest(lsp.state_init_type.method, null);
    }
}
function setup(context, client) {
    language_client = client;
    language_client.onNotification(lsp.state_output_type, params => {
        if (!panel) {
            panel = new Panel(context.extensionPath);
        }
        panel.set_content(params);
    });
}
//# sourceMappingURL=state_panel.js.map