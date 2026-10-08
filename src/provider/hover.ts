/** Hover provider — appends compiler-level cost info on measured declarations. */
import * as vscode from 'vscode';
import { MeasurementState } from '../state';

export class TypeMeterHoverProvider implements vscode.HoverProvider {
  constructor(private readonly state: MeasurementState) {}

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): vscode.Hover | undefined {
    const r = this.state.resultAt(document.uri.fsPath, position.line);
    if (!r) return undefined;
    const md = new vscode.MarkdownString('', true);
    md.isTrusted = true;
    const ms = r.firstTouchMs >= 100 ? r.firstTouchMs.toFixed(0) : r.firstTouchMs.toFixed(2);
    const attr = r.attribution
      .slice(0, 3)
      .map((a) => `\`${a.name}\` (${a.ms !== null ? a.ms.toFixed(1) + ' ms' : 'unmeasured'})`)
      .join(', ');
    md.appendMarkdown(
      `**TypeMeter** — \`${r.kind}\` \`${r.name}\`\n\n` +
      `- first touch: **${ms} ms**\n` +
      `- checker instantiations: **${r.instantiations}** · types created: **${r.typesCreated}**\n` +
      `- complexity: **${r.complexity.grade}** (${r.complexity.properties} props · union ≤ ${r.complexity.unionMembers} · depth ${r.complexity.depth} · string len ${r.complexity.typeStringLength})\n` +
      (attr ? `- cost attribution: ${attr}\n` : '') +
      `\n[Show detail](command:typemeter.showDetail?${encodeURIComponent(
        JSON.stringify([document.uri.toString(), r.line])
      )})`
    );
    return new vscode.Hover(md, new vscode.Range(position.line, 0, position.line, 0));
  }
}
