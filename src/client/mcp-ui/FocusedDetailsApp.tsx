import type { FocusedDetail } from '../../shared/schemas/details.ts';
import { Table, TableHeader } from '../components/ui/Table.tsx';
import { InventoryRow } from '../features/characters/sections/InventoryRow.tsx';
import { InventoryItemDetails } from '../features/characters/sections/inventory/InventoryItemDetails.tsx';
import { buildTree, inventoryCostTotals } from '../features/characters/sections/inventoryTree.ts';
import { LibrarySkillDetails, librarySkillMeta } from '../features/library/LibrarySkillDetails.tsx';

export function FocusedDetailsApp({
  data,
  refresh,
}: {
  data: FocusedDetail;
  refresh?: (() => void) | undefined;
}) {
  const isItem = data.kind === 'inventory_item';
  const title = isItem ? data.item.name : data.skill.name;
  const tree = isItem ? buildTree([data.item, ...data.contents]) : null;
  const costTotals = isItem ? inventoryCostTotals([data.item, ...data.contents]) : new Map();
  return (
    <main className="min-w-0 p-3 sm:p-5">
      <article className="card border border-base-300/60 bg-base-100">
        <div className="card-body min-w-0 gap-4 p-4 sm:p-5">
          <header className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="label-eyebrow">
                {isItem
                  ? data.item.isContainer
                    ? 'Container'
                    : 'Inventory item'
                  : 'Campaign library skill'}
              </p>
              <h1 className="font-display text-2xl [overflow-wrap:anywhere]">{title}</h1>
              <p className="text-sm text-base-content/60">
                {isItem ? data.characterName : librarySkillMeta(data.skill)}
              </p>
            </div>
            {refresh && (
              <button type="button" className="btn btn-sm shrink-0" onClick={refresh}>
                Refresh
              </button>
            )}
          </header>
          {isItem ? (
            <>
              <InventoryItemDetails item={data.item} />
              {data.item.isContainer && (
                <section className="min-w-0">
                  <h2 className="font-display text-lg">Contents</h2>
                  {data.contents.length === 0 ? (
                    <p className="text-sm text-base-content/60">Empty container.</p>
                  ) : (
                    <Table
                      filterable={false}
                      aria-label="Container contents"
                      preferenceKey={`mcp-contents:${data.item.id}`}
                      className="inventory-table table table-sm w-full"
                    >
                      <thead>
                        <tr>
                          <TableHeader column="item" label="Item" filterLabel="Item type" />
                          <TableHeader column="qty" label="Qty" rangeStep={1} />
                          <TableHeader column="wt" label="Wt" rangeStep={0.1} />
                          <TableHeader column="cost" label="Cost" rangeStep={1} />
                          <th scope="col">
                            <span className="sr-only">Item details</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {(tree?.byParent.get(data.item.id) ?? []).map((item) => (
                          <InventoryRow
                            key={item.id}
                            item={item}
                            depth={0}
                            byParent={tree?.byParent ?? new Map()}
                            costTotals={costTotals}
                            isSelected={() => false}
                            onRowClick={() => undefined}
                            canEdit={false}
                            expandContainers={true}
                          />
                        ))}
                      </tbody>
                    </Table>
                  )}
                </section>
              )}
            </>
          ) : (
            <div className="[overflow-wrap:anywhere]">
              <LibrarySkillDetails
                skill={data.skill}
                activeEffectsSnapshot={data.experimentalActiveEffects}
              />
            </div>
          )}
        </div>
      </article>
    </main>
  );
}
