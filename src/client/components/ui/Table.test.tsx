import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { Table, TableBody, TableFilterScope, TableHeader, TableRow } from './Table.tsx';

const rows = [
  { name: 'Ash', kind: 'Advantage', points: 5 },
  { name: 'Birch', kind: 'Disadvantage', points: 5 },
  { name: 'Cedar', kind: 'Advantage', points: 10 },
  { name: 'Empty', kind: '', points: null },
];
const firstRow = rows.find((row) => row.name === 'Ash') ?? {
  name: 'Ash',
  kind: 'Advantage',
  points: 5,
};

function Fixture({
  preferenceKey = 'test:traits',
  filterable = true,
}: {
  preferenceKey?: string;
  filterable?: boolean;
}) {
  return (
    <Table aria-label="Traits" preferenceKey={preferenceKey} filterable={filterable}>
      <thead>
        <tr>
          <TableHeader column="name" label="Trait" />
          <TableHeader column="kind" label="Type" />
          <TableHeader column="points" label="Points" />
        </tr>
      </thead>
      {rows.map((row) => (
        <TableBody key={row.name} filterValues={row} aria-label={row.name}>
          <TableRow filterValues={row} aria-label={row.name}>
            <td>{row.name}</td>
            <td>{row.kind}</td>
            <td>{row.points ?? '—'}</td>
            <td>
              <input aria-label={`${row.name} unsaved editor`} defaultValue="draft" />
            </td>
          </TableRow>
        </TableBody>
      ))}
    </Table>
  );
}

function openFilter(label: string) {
  const header = screen.getByRole('columnheader', { name: new RegExp(label) });
  fireEvent.contextMenu(header);
  return screen.getByRole('dialog', { name: `Filter ${label}` });
}

function choose(dialog: HTMLElement, value: string) {
  fireEvent.click(within(dialog).getByLabelText(value));
}

beforeEach(() => localStorage.clear());

it('routes every production JSX table through the shared table framework', () => {
  const filesUnder = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return filesUnder(path);
      return entry.isFile() && path.endsWith('.tsx') && !path.endsWith('.test.tsx') ? [path] : [];
    });
  const rawTables = filesUnder('src/client')
    .filter((path) => path !== 'src/client/components/ui/Table.tsx')
    .filter((path) => /<\s*\/?\s*table\b/.test(readFileSync(path, 'utf8')));
  expect(rawTables).toEqual([]);
});

it('filters by default and leaves an existing sort interaction independent on right-click', () => {
  const sort = vi.fn();
  render(
    <Table aria-label="Traits" preferenceKey="sorted">
      <thead>
        <tr>
          <TableHeader column="name" label="Trait">
            <button type="button" onClick={sort}>
              Sort by Trait
            </button>
          </TableHeader>
        </tr>
      </thead>
      <TableBody filterValues={{ name: 'Ash' }}>
        <TableRow filterValues={{ name: 'Ash' }}>
          <td>Ash</td>
        </TableRow>
      </TableBody>
      <TableBody filterValues={{ name: 'Birch' }}>
        <TableRow filterValues={{ name: 'Birch' }}>
          <td>Birch</td>
        </TableRow>
      </TableBody>
    </Table>,
  );
  const header = screen.getByRole('columnheader');
  fireEvent.click(within(header).getByRole('button', { name: 'Sort by Trait' }));
  expect(sort).toHaveBeenCalledOnce();
  fireEvent.contextMenu(header);
  expect(screen.getByRole('dialog', { name: 'Filter Trait' })).toBeVisible();
  expect(sort).toHaveBeenCalledOnce();
});

it('combines selected values as OR within a column and AND across columns', () => {
  render(<Fixture />);
  const type = openFilter('Type');
  choose(type, 'Advantage');
  choose(type, 'Disadvantage');
  fireEvent.keyDown(type, { key: 'Escape' });
  expect(screen.getByRole('row', { name: /Ash/ })).toBeVisible();
  expect(screen.getByRole('row', { name: /Birch/ })).toBeVisible();
  expect(screen.getByRole('row', { name: /Cedar/ })).toBeVisible();
  expect(screen.getByLabelText('Empty unsaved editor').closest('tbody')).toHaveAttribute('hidden');

  const points = openFilter('Points');
  choose(points, '5');
  fireEvent.keyDown(points, { key: 'Escape' });
  expect(screen.getByRole('row', { name: /Ash/ })).toBeVisible();
  expect(screen.getByRole('row', { name: /Birch/ })).toBeVisible();
  expect(screen.getByLabelText('Cedar unsaved editor').closest('tbody')).toHaveAttribute('hidden');
});

it('offers blank and null values and recovers from a zero-row result by clearing filters', () => {
  render(<Fixture />);
  const type = openFilter('Type');
  expect(within(type).getByText('(Blank)')).toBeVisible();
  choose(type, '(Blank)');
  fireEvent.keyDown(type, { key: 'Escape' });
  expect(screen.getByRole('row', { name: /Empty/ })).toBeVisible();
  const points = openFilter('Points');
  expect(within(points).getByLabelText('—')).toBeVisible();
  choose(points, '—');
  fireEvent.keyDown(points, { key: 'Escape' });
  expect(screen.getByRole('row', { name: /Empty/ })).toBeVisible();
  const fivePoints = openFilter('Points');
  fireEvent.click(within(fivePoints).getByRole('button', { name: 'Clear column filter' }));
  choose(fivePoints, '5');
  fireEvent.keyDown(fivePoints, { key: 'Escape' });
  expect(screen.getByText('No rows match the column filters.')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Clear all filters' }));
  expect(screen.getByRole('row', { name: /Ash/ })).toBeVisible();
  expect(screen.getByRole('row', { name: /Birch/ })).toBeVisible();
});

it('persists per preference key, reloads saved filters and changes scope when the key changes', () => {
  const view = render(<Fixture />);
  const type = openFilter('Type');
  choose(type, 'Advantage');
  fireEvent.keyDown(type, { key: 'Escape' });
  expect(screen.getByLabelText('Birch unsaved editor').closest('tbody')).toHaveAttribute('hidden');
  view.unmount();
  const reloadedView = render(<Fixture />);
  expect(screen.getByLabelText('Birch unsaved editor').closest('tbody')).toHaveAttribute('hidden');
  expect(localStorage.getItem('gpc:table-filters:v1:test:traits')).toContain('Advantage');
  reloadedView.rerender(<Fixture preferenceKey="test:skills" />);
  expect(screen.getByRole('row', { name: /Birch/ })).toBeVisible();
});

it('keeps filtering disabled when opted out', () => {
  localStorage.setItem('gpc:table-filters:v1:test:traits', JSON.stringify({ kind: ['Advantage'] }));
  render(<Fixture filterable={false} />);
  expect(screen.getByRole('columnheader', { name: 'Trait' })).toHaveTextContent('Trait');
  expect(screen.queryByRole('button', { name: 'Trait' })).not.toBeInTheDocument();
  fireEvent.contextMenu(screen.getByRole('columnheader', { name: 'Trait' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('row', { name: /Birch/ })).toBeVisible();
});

it('opens a filter with the keyboard and leaves default header behavior available', () => {
  render(<Fixture />);
  const header = screen.getByRole('columnheader', { name: 'Type' });
  fireEvent.keyDown(header, { key: 'F10', shiftKey: true });
  expect(screen.getByRole('dialog', { name: 'Filter Type' })).toBeVisible();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  fireEvent.click(header, { altKey: true });
  expect(screen.getByRole('dialog', { name: 'Filter Type' })).toBeVisible();
});

it('uses the complete source value set when only a page of rows is mounted', () => {
  render(
    <Table aria-label="Traits" preferenceKey="paged" filterRows={rows}>
      <thead>
        <tr>
          <TableHeader column="kind" label="Type" />
        </tr>
      </thead>
      <TableBody filterValues={firstRow}>
        <TableRow filterValues={firstRow}>
          <td>Ash</td>
        </TableRow>
      </TableBody>
    </Table>,
  );
  const dialog = openFilter('Type');
  expect(within(dialog).getByLabelText('Disadvantage')).toBeInTheDocument();
  expect(within(dialog).getByLabelText('(Blank)')).toBeInTheDocument();
});

it('keeps grouped editors mounted while the summary row is filtered out', () => {
  render(<Fixture />);
  const dialog = openFilter('Type');
  choose(dialog, 'Advantage');
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(screen.getByLabelText('Birch unsaved editor')).toBeInTheDocument();
  expect(screen.getByLabelText('Birch unsaved editor')).not.toBeVisible();
});

it('opens nested detail groups automatically while a filter is active', () => {
  function NestedFixture() {
    return (
      <Table aria-label="Nested" preferenceKey="nested">
        <thead>
          <tr>
            <TableHeader column="kind" label="Type" />
          </tr>
        </thead>
        <TableFilterScope>
          {(filtering) => (
            <TableBody filterValues={{ kind: 'Advantage' }}>
              <TableRow>
                <td>
                  <output>{filtering ? 'Details open for filtered rows' : 'Details folded'}</output>
                </td>
              </TableRow>
              <TableRow filterValues={{ kind: 'Advantage' }}>
                <td>Advantage row</td>
              </TableRow>
            </TableBody>
          )}
        </TableFilterScope>
      </Table>
    );
  }
  render(<NestedFixture />);
  expect(screen.getByText('Details folded')).toBeVisible();
  const dialog = openFilter('Type');
  choose(dialog, 'Advantage');
  expect(screen.getByText('Details open for filtered rows')).toBeVisible();
});

it('ignores malformed stored preferences and remains usable when storage reads or writes fail', () => {
  localStorage.setItem('gpc:table-filters:v1:test:traits', '{broken');
  const view = render(<Fixture />);
  expect(screen.getByRole('row', { name: /Ash/ })).toBeVisible();
  view.unmount();
  const getItem = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  render(<Fixture preferenceKey="blocked" />);
  const dialog = openFilter('Type');
  choose(dialog, 'Advantage');
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(screen.getByLabelText('Birch unsaved editor').closest('tbody')).toHaveAttribute('hidden');
  expect(screen.getByText(/could not remember table filters/i)).toBeVisible();
  getItem.mockRestore();
  setItem.mockRestore();
});
