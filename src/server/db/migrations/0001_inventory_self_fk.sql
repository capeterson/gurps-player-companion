-- Self-referencing FK for inventory_items.parent_id.
-- Drizzle's schema DSL has a forward-reference issue with self FKs,
-- so we add this constraint by hand.

ALTER TABLE "inventory_items"
  ADD CONSTRAINT "inventory_items_parent_id_inventory_items_id_fk"
  FOREIGN KEY ("parent_id") REFERENCES "inventory_items"("id") ON DELETE SET NULL;
