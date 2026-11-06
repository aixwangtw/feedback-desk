import { describe, expect, it } from 'vitest';
// @ts-expect-error plain browser module without type declarations
import { INTERACTIVE_SELECTOR, isInteractiveTarget, shouldOpenRowDetail } from '../../client/row-link.js';
// @ts-expect-error plain browser module without type declarations
import { completionErrorMessage, reportIdFromDialogId } from '../../client/completion.js';

const target = (interactive: boolean) => ({ closest: (selector: string) => (interactive && selector === INTERACTIVE_SELECTOR ? {} : null) });

describe('row click (whole list row and board card open the detail)', () => {
  it('opens on a plain click on the row, but not on links, buttons or inputs inside it', () => {
    expect(shouldOpenRowDetail({ button: 0, target: target(false) })).toBe(true);
    expect(shouldOpenRowDetail({ target: target(false) })).toBe(true);
    expect(shouldOpenRowDetail({ button: 0, target: target(true) })).toBe(false);
    expect(isInteractiveTarget(target(true))).toBe(true);
    expect(INTERACTIVE_SELECTOR).toContain('a,');
    expect(INTERACTIVE_SELECTOR).toContain('button');
    expect(INTERACTIVE_SELECTOR).toContain('select');
  });

  it('ignores modifier keys, other mouse buttons, handled events and text selection', () => {
    for (const extra of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { defaultPrevented: true }]) {
      expect(shouldOpenRowDetail({ button: 0, target: target(false), ...extra })).toBe(false);
    }
    expect(shouldOpenRowDetail({ button: 0, target: target(false) }, { selection: '選到的字' })).toBe(false);
  });
});

describe('completion helpers', () => {
  it('maps the dialog ids back to the report id and speaks Chinese for failures', () => {
    expect(reportIdFromDialogId('request-completion-abc-123')).toBe('abc-123');
    expect(reportIdFromDialogId('detail-report-abc-123')).toBe('abc-123');
    expect(completionErrorMessage(422, { message: '這張單已經完成' })).toBe('這張單已經完成');
    expect(completionErrorMessage(403, {})).toBe('這個操作你沒有權限。');
    expect(completionErrorMessage(500, null)).toBe('操作失敗，請稍後再試。');
  });
});
