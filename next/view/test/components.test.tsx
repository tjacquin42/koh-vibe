import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SessionView } from '../../src/shared/protocol';
import { Hint } from '../src/components/atoms/Hint';
import { IconButton } from '../src/components/atoms/IconButton';
import { Meter } from '../src/components/atoms/Meter';
import { BootBrand, BrandName } from '../src/components/organisms/Brand';
import { WORDMARK } from '../src/assets/wordmark';
import { Pressable } from '../src/components/atoms/Pressable';
import { Segmented } from '../src/components/atoms/Segmented';
import { SessionName } from '../src/components/atoms/SessionName';
import { Switch } from '../src/components/atoms/Switch';
import { ArtifactLine } from '../src/components/molecules/ArtifactLine';
import { Gauge, LineGauge } from '../src/components/molecules/Gauge';
import { Menu, MenuItem } from '../src/components/molecules/Menu';
import { Section } from '../src/components/molecules/Section';
import { Choice, SwitchRow } from '../src/components/molecules/SettingRow';
import { StatusCounts } from '../src/components/molecules/StatusCounts';
import { TabBar } from '../src/components/molecules/TabBar';
import { translator } from '../src/i18n';
import { cx } from '../src/lib/cx';
import { NOW, testCtx } from './ctx';

const html = (el: ReactElement): string => renderToStaticMarkup(el);
const noop = (): void => undefined;
const session = (extra: Partial<SessionView>): SessionView => ({ id: 'i', project: 'proj', status: 'idle', origin: 'vscode', toolCount: 0, lastEventAt: 0, ...extra });

describe('cx', () => {
  it('joins what is there and leaves out the rest', () => {
    expect(cx('row', false, undefined, 'busy', '')).toBe('row busy');
    expect(cx(false, undefined)).toBe('');
  });
});

describe('atoms', () => {
  it('IconButton: named by its label, small in a row and framed in the header', () => {
    const tool = html(<IconButton icon="trash" label="Close" onClick={noop} className="hover-only" />);
    expect(tool).toContain('class="tbtn hover-only"');
    expect(tool).toContain('aria-label="Close"');
    // What it is not is not said: no state it does not have.
    expect(tool).not.toMatch(/aria-(pressed|expanded|busy)/);
    const head = html(<IconButton kind="head" icon="plus" label="New" onClick={noop} busy pressed={false} expanded />);
    expect(head).toContain('class="ibtn busy"');
    expect(head).toContain('aria-busy="true"');
    expect(head).toContain('aria-pressed="false"');
    expect(head).toContain('aria-expanded="true"');
  });

  it('Switch: on or off, named by the label it points to', () => {
    expect(html(<Switch on labelledBy="set-x" onChange={noop} />)).toContain('role="switch" aria-checked="true" aria-labelledby="set-x"');
    expect(html(<Switch on={false} labelledBy="set-x" onChange={noop} />)).toContain('aria-checked="false"');
  });

  it('Segmented: one choice checked, a choice out of reach greyed', () => {
    const out = html(<Segmented label="Where" options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B', disabled: true }]} value="a" onChange={noop} />);
    expect(out).toContain('role="radiogroup" aria-label="Where"');
    expect(out).toMatch(/aria-checked="true"[^>]*>A</);
    expect(out).toMatch(/aria-checked="false" disabled=""[^>]*>B</);
  });

  it('Pressable: a card that is a button, loading while what it started is under way', () => {
    const idle = html(<Pressable className="card" onPress={noop}>x</Pressable>);
    expect(idle).toContain('class="card" role="button" tabindex="0" aria-busy="false"');
    const busy = html(<Pressable className="card" busy context="{}" onPress={noop}>x</Pressable>);
    expect(busy).toContain('class="card opening"');
    expect(busy).toContain('aria-busy="true"');
    expect(busy).toContain('data-vscode-context="{}"');
  });

  it('Meter: the use, and the pace mark only where there is a pace', () => {
    const plain = html(<Meter label="5 hours" percent={42} tone="run" />);
    expect(plain).toContain('role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="42" aria-label="5 hours"');
    expect(plain).toContain('class="fill tone-run" style="width:42%"');
    expect(plain).not.toContain('pace');
    expect(html(<Meter label="5 hours" percent={90} tone="wait" pace={50} paceLabel="at most 50 %" />)).toContain('class="pace" style="left:50%" title="at most 50 %"');
  });

  it('SessionName: the title, or « New » in every language for one with nothing written yet', () => {
    const t = translator('fr');
    expect(html(<SessionName s={session({ title: 'Fix the test' })} t={t} animate />)).toBe('Fix the test');
    expect(html(<SessionName s={session({ fresh: true })} t={t} animate />)).toBe('<em class="new-name moving">New</em>');
    expect(html(<SessionName s={session({ fresh: true })} t={t} animate={false} />)).toBe('<em class="new-name">New</em>');
    // A title wins over « fresh »: something was written since.
    expect(html(<SessionName s={session({ fresh: true, title: 'Named' })} t={t} animate />)).toBe('Named');
    expect(html(<SessionName s={session({ branch: 'main' })} t={t} animate />)).toBe('proj · main');
  });

  it('Hint: its bubble wraps its text — it sits in an (i) that never wraps (19/11)', () => {
    const css = readFileSync(join(__dirname, '../src/styles/app.css'), 'utf8');
    const rule = /\.hint-pop \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toContain('white-space: normal');
  });

  it('Hint: sentences, a bullet per « - » line, and the option’s name in bold', () => {
    const out = html(<Hint text={'What it does.\nOn two lines.\n- Browser: opens outside.\n- Editor : opens inside.\n- no name here'} />);
    expect(out).toContain('<p>What it does. On two lines.</p>');
    expect(out).toContain('<li><b>Browser</b> opens outside.</li>');
    expect(out).toContain('<li><b>Editor</b> opens inside.</li>');
    expect(out).toContain('<li>no name here</li>');
    // Read whole by a screen reader, without the list's dashes.
    expect(out).toContain('aria-label="What it does. On two lines. Browser: opens outside. Editor : opens inside. no name here"');
  });
});

describe('molecules', () => {
  it('StatusCounts: the three counts, named in English in every language', () => {
    const out = html(<StatusCounts counts={{ waiting: 2, running: 0, done: 5 }} t={translator('fr')} />);
    expect(out).toContain('<div class="count tone-wait"><b>2</b><span>waiting for you</span></div>');
    expect(out).toContain('<div class="count tone-run"><b>0</b><span>working</span></div>');
    expect(out).toContain('<div class="count tone-done"><b>5</b><span>finished</span></div>');
  });

  it('Section: folds only when it can, and keeps its tools outside the fold button', () => {
    const fixed = html(<Section title="Recent">body</Section>);
    expect(fixed).not.toContain('sec-btn');
    expect(fixed).toContain('body');
    const folded = html(
      <Section title="Shop" count={3} folded onToggle={noop} tools={<i>tool</i>}>
        body
      </Section>,
    );
    expect(folded).toContain('aria-expanded="false"');
    expect(folded).toContain('<span class="n">3</span>');
    expect(folded).toContain('</button><span class="sec-tools"><i>tool</i></span>');
    expect(folded).not.toContain('body');
    expect(html(<Section title="Shop" folded={false} onToggle={noop}>body</Section>)).toContain('aria-expanded="true"');
  });

  it('Menu: lines with an icon, red for what destroys', () => {
    const out = html(
      <Menu label="Shop">
        <MenuItem icon="edit" onClick={noop}>
          Rename
        </MenuItem>
        <MenuItem icon="trash" danger onClick={noop}>
          Delete
        </MenuItem>
      </Menu>,
    );
    expect(out).toContain('class="fmenu" role="group" aria-label="Shop"');
    expect(out).toMatch(/class="fm-btn"><svg[^]*<\/svg> Rename</);
    expect(out).toMatch(/class="fm-btn danger"><svg[^]*<\/svg> Delete</);
  });

  it('SettingRow: a switch named by its row, a choice greyed when out of use', () => {
    const row = html(<SwitchRow id="set-animate" label="Animations" hint="Moves things." on onChange={noop} />);
    expect(row).toContain('<b id="set-animate">Animations</b>');
    expect(row).toContain('aria-labelledby="set-animate"');
    expect(row).toContain('class="hint-i"');
    const off = html(<Choice label="Colour" off>x</Choice>);
    expect(off).toContain('class="set-row set-choice off" aria-disabled="true"');
    // Nothing to explain: no (i).
    expect(off).not.toContain('hint-i');
    expect(html(<Choice label="Colour">x</Choice>)).not.toContain('aria-disabled');
  });

  it('TabBar: the tabs in the order given, their whole name beside the icon, one selected — or none', () => {
    const bar = (selected: 'a' | 'b' | undefined): string =>
      html(<TabBar className="tabs" label="Tabs" order={['b', 'a']} selected={selected} icon={{ a: 'chat', b: 'doc' }} name={(id) => (id === 'a' ? 'Sessions' : 'Artifacts')} flipKey="tab" controls="panel" animate onSelect={noop} onOrder={noop} />);
    const out = bar('a');
    expect(out.indexOf('data-flip="tab:b"')).toBeLessThan(out.indexOf('data-flip="tab:a"'));
    expect(out).toMatch(/data-flip="tab:a" data-name="Sessions" aria-selected="true" aria-controls="panel"/);
    expect(out).toMatch(/data-flip="tab:b" data-name="Artifacts" aria-selected="false"/);
    // The whole name or none of it: never one cut short (15/11).
    expect(out).toContain('<span>Sessions</span>');
    expect(out).not.toContain('…');
    expect(bar(undefined)).not.toContain('aria-selected="true"');
  });

  it('ArtifactLine: the page and its age — and, just filed in a folder, a tick and where it went (16/11)', () => {
    const plain = html(<ArtifactLine name="Release plan" openLabel="Release plan — Open" age="40 min" onOpen={noop} />);
    expect(plain).toContain('aria-label="Release plan — Open"');
    expect(plain).toContain('<span class="tm">40 min</span>');
    expect(plain).not.toContain('filed-in');
    const filed = html(<ArtifactLine name="Release plan" openLabel="Release plan — Open" age="40 min" filedIn="→ Shop" onOpen={noop} />);
    // Where it went takes the place of its age for a moment, said to a screen reader too.
    expect(filed).toContain('<span class="tm filed-in" role="status">→ Shop</span>');
    expect(filed).not.toContain('40 min');
    // No age to show, none shown: the line of a folder's artifact.
    expect(html(<ArtifactLine name="Notes" openLabel="Notes — Open" onOpen={noop} />)).not.toContain('class="tm');
  });

  it('Gauge: the whole percentage within 0–100, amber from 85 %, a reset only while it is ahead', () => {
    const ctx = testCtx();
    const hour = 3_600_000;
    const calm = html(<Gauge ctx={ctx} label="5 hours" w={{ percent: 41.6, resetsAt: NOW + 2.5 * hour }} span={5 * hour} />);
    expect(calm).toContain('<span class="mono">42 %</span>');
    expect(calm).toContain('fill tone-run');
    // Half the window gone: the pace mark stands at half the bar.
    expect(calm).toContain('class="pace" style="left:50%"');
    expect(calm).toContain('class="g-l2"');
    const hot = html(<Gauge ctx={ctx} label="Week" w={{ percent: 130, resetsAt: NOW - 1 }} span={5 * hour} />);
    expect(hot).toContain('<span class="mono">100 %</span>');
    expect(hot).toContain('fill tone-wait');
    expect(hot).not.toContain('pace');
    expect(hot).not.toContain('g-l2');
    const line = html(<LineGauge ctx={ctx} label="5 h" w={{ percent: 85 }} span={5 * hour} />);
    expect(line).toContain('fill tone-wait');
    expect(line).toContain('<span class="lg-r"></span>');
  });
});

describe('the name (C2)', () => {
  it('is the large drawing as one image in the sidebar, named for screen readers by its button', () => {
    const out = html(<BrandName text="Koh-Vibe" striped />);
    expect(out).toContain('aria-label="Koh-Vibe"');
    expect(out).toContain('class="brand-img"');
    expect(out).toContain('alt=""');
    expect(out).toContain(WORDMARK.slice(0, 40));
    // The rainbow's mask is the same image.
    expect(out).toContain('--brand-mask');
  });

  it('stays text in the cockpit', () => {
    const out = html(<BrandName text="Cockpit" />);
    expect(out).toContain('>Cockpit</button>');
    expect(out).not.toContain('brand-img');
  });

  it('shows the same image while loading, with its rainbow cut to the image', () => {
    const out = html(<BootBrand label="Waiting" />);
    expect(out).toContain('role="status"');
    expect(out).toContain('class="brand-img"');
    expect(out).toContain('brand-band brand-band-mask boot-band');
  });

  it('is a PNG image', () => {
    expect(WORDMARK.startsWith('data:image/png;base64,')).toBe(true);
  });
});
