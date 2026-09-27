## Start with a small, usable library

A campaign library is the collection of definitions your players can reuse: traits, skills, spells, equipment, languages, techniques, styles, enchantments, and active effects. A library entry describes the rule; a character's copy records that character's choices, points, quantities, and current state.

Open **Campaign → your campaign → Library**. Campaign members can browse; the **campaign owner** can add, edit, delete, and import definitions. Being a campaign manager does not grant library-authoring permission.

Start with the entries needed for the next session. For each entry, decide:

- What does the player choose: a level, specialization, edition, or equipment option?
- What can the app calculate, and what must the GM adjudicate?
- Which book, page, or house rule explains the definition?

Keep uncertain material as **Needs review**. Promote it to **Complete** after checking its fields and trying it on a test character. The app does not extract rules from PDFs or turn descriptive prose into mechanics.

## Create and check your first entry

1. Choose a category, such as **Traits**, and select **+ Add trait**.
2. Enter a name, its basic values, a short description, and a source citation. For a simple fixed-price trait, enter **Base pts**; an item uses **Cost ($)** and **Weight (lb)**.
3. Add the rule's exceptions and manual steps to its description. Formatting and lists make these easier to read at the table.
4. Open optional advanced controls only when the entry needs them. A description, a price, and a mechanical bonus are separate things: entering “+1 to a skill” in prose does not apply that bonus.
5. Select **Add trait**, **Add item**, or the corresponding save action. Wait for the header sync indicator to settle, then open the entry and confirm the saved values.
6. Create a test character, assign it to this campaign from **Overview → Identity → Campaign**, and add the entry from its sheet picker. Check the resulting points, weight, skill level, or combat values.

Try at least two choices for a variable rule, including its minimum and maximum. Reload the page and inspect the saved choice again. A successful save proves the data was accepted; it does not prove that every rule in the description is automated.

The **Library guide** link opens this article in another tab, so consulting it does not close an unfinished entry form.

## Organize sources, editions, and completeness

Use **Sources → + Add source** for a publication or a house-rule collection. Supply its **Publication title**, **Source key**, and **Abbreviation**. Edition and notes help distinguish revisions; **Priority (lower first)** chooses among otherwise equivalent sources.

For an entry's source metadata:

- **Canonical key** identifies the concept. Use a stable value such as `field-training`; changing the display name need not change that identity.
- **Source key** associates the entry with a source. Reuse the source's key exactly.
- **Page or locator** identifies the specific rule. The shorter **Source** citation is useful to readers but does not create a source association by itself.
- **Preferred edition** explicitly selects the default version of that concept. Do not mark two versions of the same concept as preferred.
- **Review notes** explain unresolved questions without pretending they are implemented rules.

Only **Complete** entries whose **Content role** is **Definition** or **Template** can be adopted through character pickers. **Needs review**, **Reference only**, **Example**, and **Reference** entries remain library material rather than purchasable definitions. If an entry is missing from a picker, check these fields before recreating it.

Keep alternate editions under the same canonical key and different source keys. The normal character picker offers preferred adoptable editions; **Other sources** reveals alternatives. Verify which edition you selected before accepting its price.

## Choose the right kind of definition

**Traits** describe advantages, disadvantages, perks, quirks, and other character features. Keep their price, optional modifiers, and mechanical effects distinct. A paid advantage with no declared mechanical effects still records its points and description.

**Skills** need an attribute and difficulty. Under **Prerequisites, defaults and tags**, add common attribute, skill, trait or GM-permission prerequisites and attribute/skill defaults with the guided controls. **Require both** adds an AND condition; **Allow either** makes an alternative to the existing requirement. **Set no defaults** explicitly prohibits defaulting; a blank advanced defaults field leaves the rule unspecified. Use advanced JSON for nested conditions, specializations and relative levels. Choose a specialization policy: none, optional/required free text, or optional/required catalog. A catalog constrains the choices and can provide different descriptions, prerequisites, or defaults for each specialty. Set the Tech Level policy separately; a required TL is a character choice, while a fixed TL belongs to the definition.

**Spells** record college, difficulty, base **Cost**, **Upkeep**, casting time, duration, and prerequisites. The cost fields hold numbers. Explain variable costs, resistance, area, and special circumstances in the description; the casting dialog's **Energy to spend** is the final amount the player chooses to pay. Textual prerequisites and durations are not automatically enforced or turned into timed effects.

**Items** combine price and weight with optional weapon, armor, container, or magical data. Open **Armor facets** for guided protection fields: select coverage, enter base DR and any damage-type overrides, then choose flexibility and facing. Leave an override blank to use base DR. Use **Edit armor YAML** for advanced data; return to visual fields after correcting any validation errors. A descriptive category name alone does not supply combat statistics. One physical item may have several facets; do not create two inventory items merely because it can be both a weapon and a shield.

**Languages** describe the language and whether it is signed. The character chooses fluency and pays its points. Selecting a sign-language definition sets written fluency to **N/A**. Review the **Pts** field: its suggested total treats native spoken fluency as free and cannot determine whether this is the character's first or an additional language. Enter the appropriate total for the campaign's rules before adding it. **Techniques** describe a governing skill, default penalty, difficulty, and maximum improvement. **Styles** group skills, perks, and techniques; they are packages of components, not a separate character stat.

**Enchantments** attach equipment-specific mechanics. **Active Effects** are reusable temporary effects applied to a character. A spell's description, an item enchantment, and an active-effect instance serve different purposes; creating one does not automatically create the others.

## Advanced: pricing and modifiers

Open **Calculated pricing (optional)** when a fixed number is insufficient. The visual patterns cover fixed amounts, per-unit prices, bounded values, and choices or lookup tables. Fill in the pattern's options, then select **Use pattern** to apply it. Changing a pattern control without applying it does not replace the saved rule.

**Use pattern replaces the current calculation.** Do not use it to make a small edit to a complex rule unless replacement is intended. Inspect **Advanced rule (YAML)** to see or edit the complete calculation. **Use basic price fields** removes the calculation and returns to the fixed fields; check those values before saving.

For a per-unit rule, choose the unit and specify its minimum, maximum, and step. Give choices meaningful labels and stable keys. For an item, the preset's **Fixed weight for preset (lb)** is independent of its cost: making cost depend on quantity or size does not also scale weight. Rules that vary both outputs need an advanced calculation.

### Worked house-rule example

This example is invented for learning the editor. It prices “Field Training” at 5 points plus 3 points per level, from level 1 to 4. In a trait, open **Calculated pricing (optional)** and **Advanced rule (YAML)**, then use:

```yaml
version: 1
inputs:
  - key: level
    label: Training level
    kind: number
    unit: level
    min: 1
    max: 4
    step: 1
    default: 1
tables: []
nodes:
  - { id: base, op: constant, value: 5 }
  - { id: rate, op: constant, value: 3 }
  - { id: level, op: input, key: level }
  - { id: levelCost, op: multiply, args: [rate, level] }
  - { id: total, op: add, args: [base, levelCost] }
outputs:
  - key: points
    unit: points
    node: total
    rounding: exact
    increment: 1
    min: 0
    max: 100
```

Check that levels 1, 2, and 4 resolve to 8, 11, and 17 points. Pricing inputs calculate the purchase price; they do not, by themselves, declare stat or skill bonuses.

### Rules with several inputs

Advanced calculations can combine bounded inputs, conditions, lookup tables, rounding, and references to other definitions. Every node needs a unique ID; references must exist and must not form a cycle. A trait produces a `points` output; an item produces both `cost` and `weightLbs`; a modifier produces `modifier`. Each output declares its unit, bounds, increment, and rounding.

Work from an exported, working example and change one part at a time. Unfinished formulas belong in review notes until they validate. Do not replace a missing value with zero just to make an entry save.

### Enhancements and limitations

Use a trait's modifiers for choices specific to that trait, or **Modifiers** for reusable enhancements and limitations. Choose percentage versus flat-point cost deliberately. Applicability determines which traits can select a modifier; a **Mutually exclusive group** prevents incompatible choices from being selected together.

A modifier's price and its mechanical effect are separate. If a choice also changes a roll, DR, damage, or a capability, model the supported effect explicitly and describe any remaining manual rule. Inspect the final price preview rather than applying the same percentage again by hand.

## Advanced: equipment and mechanical effects

For a weapon, give each attack mode its own name and stable key. Enter its governing skill, damage, reach or range, parry, minimum ST, and ranged statistics as appropriate. Alternate modes do not silently inherit omitted values from one another. Keep swing and thrust attacks on the same physical item when they share one cost and weight.

Range distinguishes **fixed yards** from **ST multipliers**. Enter the half-damage and maximum values in the appropriate mode. Check the adopted weapon on a character whose ST differs from your first test character; this catches a multiplier accidentally entered as a fixed distance.

Armor uses structured data for coverage and protection. Check the intended hit locations, any damage-type-specific DR, and facing. Test the character's **Incoming attack** workspace with more than one damage type. Armor DB and DR are different: DB affects defense rolls; DR reduces injury.

**Mechanical effects** add supported attribute, skill, defense, DR, or weapon adjustments. Use exact skill or item selectors when required. Conditional effects need the appropriate condition enabled, and equipment effects may require the item to be equipped or carried. A rule that needs GM judgment should say so in its description rather than apply an unconditional bonus.

For enchantments, check applicability and stacking. Two copies with an additive policy can differ from two effects sharing a highest-only stacking key. Apply only the intended base statistics to the item; avoid baking an enchantment's bonus into the base and then attaching the same bonus again.

## Advanced: skills, spells, and active effects

Skill authoring separates readable prerequisite text from **Structured prerequisites (JSON)**, **Default rules (JSON)**, and **Structured skill rules**. The readable description explains the rule. Structured fields describe supported conditions and calculations; they cannot interpret arbitrary rules prose.

For example, this invented structured prerequisite requires both IQ 11 and a trait named Field Training:

```json
{
  "kind": "all",
  "children": [
    { "kind": "attribute", "attribute": "IQ", "minimum": 11 },
    { "kind": "trait", "name": "Field Training", "minimumLevel": 1 }
  ]
}
```

Use `any` instead of `all` only when satisfying one branch is enough. Skill defaults can depend on another skill or attribute; keep the specialty and learned TL constraints faithful to the rule. Test a character that satisfies the requirement and another that does not. Campaign prerequisite enforcement and GM adjudication are separate from simply storing the text.

### A book-rule checklist

Alchemy in *GURPS Magic*, p. 210, provides a useful authoring check: choose **IQ** and **Very Hard**, then **Set no defaults**. Leaving defaults unspecified does not express the same rule. For an elixir technique that defaults at Alchemy−1 and cannot exceed Alchemy, choose **Hard**, enter **−1** as the default penalty, and **1** as the maximum levels above default. The cap is measured from the penalized default, not from the governing skill. Test that additional points cannot push it past Alchemy.

A variable-energy spell such as Ignite Fire (*Magic*, p. 73) needs its different cases explained in the description and the final casting energy selected by the player. A spell with a listed duration, such as Daze (*Magic*, p. 134), still needs a separately applied active effect if you want the app to track temporary mechanics. Consult the original rule for its full conditions and exceptions.

Skill procedures can describe contextual modifiers, actions, and benefits. A calculated roll preview does not automatically resolve an opponent's contest, spend all described resources, or apply a described outcome to another character. Check the visible preview and explain the manual steps.

For variable-cost spells, store a clearly explained base case and describe how the cost changes. At casting time, check **Energy to spend** after any applicable discounts and choices. Casting time, duration, and prerequisites in a spell entry remain descriptive; do not assume a timed condition will appear because the spell was cast.

Apply temporary mechanics through the character's **Combat → Active Effects** panel. Choose a campaign effect or create a custom one, optionally identify its source item, and inspect its bonuses and remaining duration. Every definition needs an effect name and a **Stacking key**. Give related effects the same key: **additive** combines their bonuses, **highest** keeps the strongest value per target, and **replace** uses the latest application. Different keys work independently.

Activating an expired or inactive effect starts its duration again. Advancing effects by one round and advancing the solo tracker are alternative ways to move round durations forward; do not do both for the same round. Applying an effect does not consume its source item.

## Import, export, and bulk maintenance

Use **Export YAML** to keep a portable copy before a substantial change. The export contains library definitions; it is not a full character or campaign backup. The current format is version 13. Use an export as your starting template so field names and nested structures match the app.

In **Import YAML**, choose the mode, select a file, inspect the preview, then confirm:

- **Merge** adds new identities and updates matching ones without deleting other entries. It can still overwrite matching definitions.
- **Replace** also removes existing entries absent from the uploaded sections. Use it only when the file is intended to be authoritative. Optional omitted sections are preserved; explicitly empty arrays request an empty section.

Identity uses canonical key and source edition, plus kind for traits. Changing an explicit key is different from renaming an entry and can create a new identity. Read the preview rather than assuming names alone control replacement. Review the campaign-settings option before importing settings along with content.

Library browsing and ordinary entry edits work from the local copy, including offline. **YAML import requires a connection.** Wait for ordinary edits to sync before exporting a server copy or coordinating a bulk import with another editor. Do not interpret an unsynced indicator as proof that a second device has the new content.

## Update existing content deliberately

Library changes and character purchases have different lifecycles. Linked mechanical definitions can refresh from the library; an existing character's resolved purchase price and selected pricing inputs remain recorded until that purchase is explicitly repriced.

When a price changes, inspect the existing trait or inventory editor and use its **Re-resolve pricing** workflow. Review the new inputs and result before accepting. A source deletion or campaign transfer can leave a retained copy rather than silently substituting another edition with the same name.

Before a campaign-wide correction, test one definition and one character. Compare the sheet, point ledger or inventory totals, and history. Check a new purchase as well as an older one; their prices need not change together.

## Troubleshoot an entry

**No Add or Edit controls:** confirm that you are the campaign owner and that the correct campaign is selected.

**Entry is saved but absent from a character picker:** check campaign assignment, completeness, content role, source edition, and search/filter settings. Try **Other sources** before making a duplicate.

**Save is unavailable:** check required fields and expanded advanced editors for validation messages. Invalid JSON/YAML or an incomplete specialization catalog keeps the form open; correct it before saving.

**Price did not change:** confirm that you selected **Use pattern**, or that you edited the advanced rule successfully. For an existing character purchase, check whether explicit repricing is required.

**A described bonus is missing:** descriptions do not create effects. Check the structured effect, selector, condition, equipment state, and stacking policy. Test the underlying value before and after applying the effect.

**A saved value reverts:** inspect the error message and the header sync log. Resolve the rejected value or conflicting edit before retrying. Avoid repeatedly creating a new entry to work around a failed update.

**The source rule cannot be represented faithfully:** preserve a citation and explanation, leave unresolved definitions as **Needs review** or **Reference only**, and record the manual procedure. A partly automated rule should clearly identify which steps the player or GM still performs.
