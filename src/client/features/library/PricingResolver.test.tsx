import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fixedCalculation } from '../../../shared/domain/calculation.ts';
import type { LibraryGraph } from '../../../shared/domain/libraryGraph.ts';
import type { PricedDefinition } from '../../../shared/domain/libraryPricing.ts';
import { CalculationInputsEditor, PricingResolver } from './PricingResolver.tsx';
import { useLocalLibrary } from './useLocalLibrary.ts';

vi.mock('./useLocalLibrary.ts', () => ({ useLocalLibrary: vi.fn() }));

const entry: PricedDefinition = {
  id: '0193b3c0-f1f0-7000-8000-00000000f401',
  revision: 4,
  name: 'Night Vision',
  key: 'night vision',
  sourceId: '0193b3c0-f1f0-7000-8000-00000000f402',
  kind: 'advantage',
  status: 'complete',
  role: 'definition',
  calculation: fixedCalculation({ points: { value: 5, unit: 'points' } }),
};

const graph: LibraryGraph = {
  sources: [
    { id: '0193b3c0-f1f0-7000-8000-00000000f402', name: 'Core', abbreviation: 'CR', priority: 1 },
  ],
  modifiers: [],
  traits: [entry],
  items: [],
};

describe('PricingResolver', () => {
  const onResolve = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useLocalLibrary).mockReturnValue(graph as never);
    if (!HTMLDialogElement.prototype.showModal) {
      HTMLDialogElement.prototype.showModal = function () {
        this.open = true;
      };
    }
  });

  it('shows a resolved snapshot and returns its points and definition provenance', () => {
    render(
      <PricingResolver
        campaignId="campaign"
        section="traits"
        entry={entry}
        onResolve={onResolve}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Resolve Night Vision' })).toBeVisible();
    expect(screen.queryByText('core · complete')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Calculation breakdown')).toHaveTextContent('points: 5');
    expect(screen.getByText('Total: 5 points')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Use these values' }));
    expect(onResolve).toHaveBeenCalledWith(
      expect.objectContaining({
        definitionId: '0193b3c0-f1f0-7000-8000-00000000f401',
        revision: 4,
        outputs: { points: 5 },
      }),
      [],
      5,
    );
  });

  it('keeps incomplete entries from being adopted and shows the reason', () => {
    vi.mocked(useLocalLibrary).mockReturnValue({
      ...graph,
      traits: [{ ...entry, status: 'needs_review' }],
    } as never);
    render(
      <PricingResolver
        campaignId="campaign"
        section="traits"
        entry={{ ...entry, status: 'needs_review' }}
        onResolve={onResolve}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Library entry is incomplete or unavailable',
    );
    expect(screen.getByRole('button', { name: 'Use these values' })).toBeDisabled();
    expect(onResolve).not.toHaveBeenCalled();
  });

  it('renders reserved-name defaults and preserves __proto__ as an editable input key', () => {
    const onChange = vi.fn();
    render(
      <CalculationInputsEditor
        rule={{
          version: 1,
          inputs: [
            {
              key: 'constructor',
              kind: 'number',
              label: 'Constructor',
              unit: 'count',
              min: 0,
              max: 10,
              step: 1,
              default: 3,
            },
            {
              key: '__proto__',
              kind: 'number',
              label: 'Prototype',
              unit: 'count',
              min: 0,
              max: 10,
              step: 1,
              default: 1,
            },
          ],
          tables: [],
          nodes: [{ id: 'value', op: 'constant', value: 1 }],
          outputs: [
            {
              key: 'points',
              unit: 'points',
              node: 'value',
              rounding: 'exact',
              increment: 1,
              min: 0,
              max: 10,
            },
          ],
        }}
        values={{}}
        onChange={onChange}
      />,
    );

    expect(screen.getByLabelText('Constructor')).toHaveValue(3);
    expect(screen.getByLabelText('Prototype')).toHaveValue(1);
    fireEvent.change(screen.getByLabelText('Prototype'), { target: { value: '7' } });
    const next = onChange.mock.calls.at(-1)?.[0] as Record<string, number> | undefined;
    expect(next).toBeDefined();
    expect(Object.hasOwn(next ?? {}, '__proto__')).toBe(true);
    expect(next ? Reflect.get(next, '__proto__') : undefined).toBe(7);
  });
});
