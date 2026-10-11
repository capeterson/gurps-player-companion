-- Equipped means worn or wielded, so it is valid only on the player: a root
-- item carried (`worn`, no external location) or anything inside a container
-- whose root is carried. Earlier API writes could equip stashed items; clear
-- those flags. Updates bump revisions, so every device pulls the corrected rows.
WITH RECURSIVE on_player(id) AS (
  SELECT id FROM inventory_items
  WHERE parent_id IS NULL AND worn AND external_location IS NULL
  UNION
  SELECT child.id FROM inventory_items child
  JOIN on_player parent ON child.parent_id = parent.id
)
UPDATE inventory_items
SET equipped = false, updated_at = now()
WHERE equipped AND id NOT IN (SELECT id FROM on_player);
