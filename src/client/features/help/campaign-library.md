## Start with a small, usable library

A campaign library is the collection of definitions your players can reuse: sources, modifiers, races, traits, skills, spells, equipment, languages, techniques, styles, enchantments, and active effects. A library entry describes the rule; a character's copy records that character's choices, points, quantities, and current state.

Open **Campaign → your campaign → Library**. Campaign members can browse; the **campaign owner** can add, edit, delete, and import definitions. Being a campaign manager does not grant library-authoring permission.

Start with the entries needed for the next session. For each entry, decide:

- What does the player choose: a level, specialization, edition, or equipment option?
- What can the app calculate, and what must the GM adjudicate?
- Which book, page, or house rule explains the definition?

Keep uncertain material as **Needs review**. Promote it to **Complete** after checking its fields and trying it on a test character. The app does not extract rules from PDFs or turn descriptive prose into mechanics.

## Create and check your first entry

1. Choose a category, such as **Traits**, and select **+ Add trait**.
2. Enter a name, its basic values, a short description, and a source citation. For a simple fixed-price trait, enter **Base points**; an item uses **Cost** and **Weight (lb)**.
3. Add the rule's exceptions and manual steps to its description. Formatting and lists make these easier to read at the table.
4. Open optional advanced controls only when the entry needs them. A description, a price, and a mechanical bonus are separate things: entering “+1 to a skill” in prose does not apply that bonus.
5. Select **Add trait**, **Add item**, or the corresponding save action. Wait for the header sync indicator to settle, then open the entry and confirm the saved values.
6. Create a test character, assign it to this campaign from **Overview → Identity → Campaign**, and add the entry from its sheet picker. Check the resulting points, weight, skill level, or combat values.

Try at least two choices for a variable rule, including its minimum and maximum. Reload the page and inspect the saved choice again. A successful save proves the data was accepted; it does not prove that every rule in the description is automated.

The **Library guide** link opens this article in another tab, so consulting it does not close an unfinished entry form.

## Organize sources, editions, and completeness

Use **Sources → + Add source** for a publication or a house-rule collection. Supply its publication **Name** and **Abbreviation**. Edition and notes help distinguish revisions; lower **Priority** values choose among otherwise equivalent sources.

For an entry's source metadata:

- **Sourcebook** selects the publication, labeled with its abbreviation and title.
- **Page** sits beside the sourcebook in a compact field. Enter the printed page number; existing page ranges and section references are retained. The separate **Source** citation is useful to readers but is not generated from these fields.
- **Preferred edition** explicitly selects the default version of that concept. Do not mark two versions of the same concept as preferred.
- **Review notes** explain unresolved questions without pretending they are implemented rules. **Excerpt location** identifies the original excerpt separately from the publication page.
- **Match another edition** links the concept to an existing named definition in a different source without exposing its internal identifier.

Only **Complete** entries whose **Content role** is **Definition** or **Template** can be adopted through character pickers. **Needs review**, **Reference only**, **Example**, and **Reference** entries remain library material rather than purchasable definitions. If an entry is missing from a picker, check these fields before recreating it.

The normal character picker offers preferred adoptable editions; **Other sources** reveals alternatives. Verify which edition you selected before accepting its price.

## Choose the right kind of definition

**Traits** describe advantages, disadvantages, perks, quirks, and other character features. Keep their price, optional modifiers, and mechanical effects distinct. A paid advantage with no declared mechanical effects still records its points and description.

**Skills** need an attribute and difficulty. Under **Requirements and defaults**, build prerequisite rules with nested **All of these** or **Any of these** branches. A branch can check an attribute, skill, trait, tech level, campaign rule, or GM permission. Skill requirements can distinguish absolute level, relative level, points, and specialization. Defaults can select an attribute, skill, group, or tag and carry conditions. To prohibit defaulting, choose **Set value** for **Defaults** and keep the list empty; **Not specified** or **None** leaves defaulting unknown. Choose a specialization policy: none, optional/required free form, or optional/required catalog. Catalog choices can inherit, clear, or override descriptions, prerequisites and defaults. Set the TL policy separately; a required TL is a character choice, while a fixed TL belongs to the definition. Groups and tags use separate list rows, so commas inside a name remain part of that name.

**Spells** record college, difficulty, base **Energy cost**, **Maintenance cost**, casting time, duration, and prerequisites. The cost fields hold numbers. Explain variable costs, resistance, area, and special circumstances in the description; the casting dialog's **Energy to spend** is the final amount the player chooses to pay. Textual prerequisites and durations are not automatically enforced or turned into timed effects.

**Items** combine price and weight with optional weapon, armor, container, or magical data. Open **Equipment facets → Armor protection** for guided protection fields: select coverage, enter base DR and any damage-type overrides, then choose flexibility and facing. Leave an override blank to use base DR. Use **All armor fields** for the complete typed definition, or the entry’s **Raw YAML** disclosure for its source. Return to visual fields after correcting validation errors. A descriptive category name alone does not supply combat statistics. One physical item may have several facets; do not create two inventory items merely because it can be both a weapon and a shield.

**Languages** describe the language and whether it is signed. The character chooses fluency and pays its points. Selecting a sign-language definition sets written fluency to **N/A**. Review the **Pts** field: its suggested total treats native spoken fluency as free and cannot determine whether this is the character's first or an additional language. Enter the appropriate total for the campaign's rules before adding it. **Techniques** describe a governing skill, default penalty, difficulty, and maximum improvement. **Styles** group skills, perks, and techniques; they are packages of components, not a separate character stat.

**Enchantments** attach equipment-specific mechanics. Item attachments have editable levels, casting skill and notes. A linked attachment gets its mechanics from the reusable definition. Choose **Make independent** to retain and edit its own mechanics instead. Spell descriptions and item enchantments serve different purposes; creating one does not automatically create the other.

**Races** describe a complete racial profile with variants, forms and additive lenses. Tags remain separate list rows. Pick compatible races by name, then review any named trait or skill removals in a lens. Racial effects use the same campaign item selectors as trait effects.

**Powerstones and magic items** are optional equipment facets. Enter capacity and starting energy for a powerstone; choose a magic item’s mode, spell, casting skill, charges and energy cost. Editing another field preserves imported values, including values belonging to an inactive container facet.

## Advanced: pricing and modifiers

Open **Calculated pricing (optional)** when a fixed number is insufficient. The visual patterns cover fixed amounts, per-unit prices, bounded values, and choices or lookup tables. Fill in the pattern's options, then select **Use pattern** to apply it. Changing a pattern control without applying it does not replace the saved rule.

**Use pattern replaces the current calculation.** Do not use it to make a small edit to a complex rule unless replacement is intended. Use **Calculation definition** to edit all inputs, lookup tables, expression steps and outputs. The entry’s subtle **Raw YAML** disclosure also shows the complete definition. **Use basic price fields** removes the calculation and returns to the fixed fields; check those values before saving.

For a per-unit rule, choose the unit and specify its minimum, maximum, and step. Give choices meaningful labels and stable keys. For an item, the preset's **Fixed weight for preset (lb)** is independent of its cost: making cost depend on quantity or size does not also scale weight. Rules that vary both outputs use separate outputs in the full **Calculation definition** controls.

### Worked house-rule example

This example is invented for learning the editor. It prices “Field Training” at 5 points plus 3 points per level, from level 1 to 4. In a trait, open **Calculated pricing (optional)** and use the full typed calculation controls. For the equivalent source, open the entry’s **Raw YAML** and add this `calculation` block while retaining its other fields:

```yaml
calculation:
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

**Mechanical effects** add supported attribute, skill, defense, DR, or weapon adjustments. Use exact skill or item selectors when required. Equipment effects may require the item to be equipped or carried. A rule that needs GM judgment should say so in its description rather than apply an unconditional bonus.

For enchantments, check applicability and stacking. Two copies with an additive policy can differ from two effects sharing a highest-only stacking key. Apply only the intended base statistics to the item; avoid baking an enchantment's bonus into the base and then attaching the same bonus again.

## Advanced: skills and spells

Skill authoring separates readable prerequisite text from typed **Prerequisite rules**, **Defaults**, and **Contextual rules and actions**. The readable description explains the rule. Structured fields describe supported conditions and calculations; they cannot interpret arbitrary rules prose.

Choose **All of these**, then add attribute and trait requirements for IQ 11 and Field Training level 1. The corresponding portion of an entry’s raw YAML is:

```yaml
prerequisiteRules:
  kind: all
  children:
    - { kind: attribute, attribute: IQ, minimum: 11 }
    - { kind: trait, name: Field Training, minimumLevel: 1 }
```

Use `any` instead of `all` only when satisfying one branch is enough. Skill defaults can depend on another skill or attribute; keep the specialty and learned TL constraints faithful to the rule. Test a character that satisfies the requirement and another that does not. Campaign prerequisite enforcement and GM adjudication are separate from simply storing the text.

### A book-rule checklist

Alchemy in *GURPS Magic*, p. 210, provides a useful authoring check: choose **IQ** and **Very Hard**, then set **Defaults** to **Set value** with an empty list. Leaving defaults unspecified does not express the same rule. For an elixir technique that defaults at Alchemy−1 and cannot exceed Alchemy, choose **Hard**, enter **−1** as the default penalty, and **1** as the maximum levels above default. The cap is measured from the penalized default, not from the governing skill. Test that additional points cannot push it past Alchemy.

A variable-energy spell such as Ignite Fire (*Magic*, p. 73) needs its different cases explained in the description and the final casting energy selected by the player. A spell with a listed duration, such as Daze (*Magic*, p. 134), still needs its temporary mechanics tracked separately. Consult the original rule for its full conditions and exceptions.

Under **Contextual rules and actions**, skill procedures expose typed contextual modifiers, predicates, stacking limits, actions, resource costs, contests, outcomes and level benefits. A calculated roll preview does not automatically resolve an opponent's contest, spend all described resources, or apply a described outcome to another character. Check the visible preview and explain the manual steps.

For variable-cost spells, store a clearly explained base case and describe how the cost changes. At casting time, check **Energy to spend** after any applicable discounts and choices. Casting time, duration, and prerequisites in a spell entry remain descriptive; do not assume a timed condition will appear because the spell was cast.

## Experimental: active effects

The campaign owner can opt in under **Campaign settings → Experimental features → Enable active effects**. This feature is unfinished and off by default. Turning it off hides character instance management and disables active instances and conditional modifiers while preserving saved data. Campaign owners can still edit archived Active Effects definitions and conditional declarations in the library, including capability parameters and condition labels. Manual stat modifiers and skill procedures work independently.

Conditional modifiers need their condition enabled in **Overview → Conditional effects** or **Combat → Active Effects**. Conditional declarations stay inactive when the experiment is off.

Apply temporary mechanics through the character's **Combat → Active Effects** panel. Choose a campaign effect or create a custom one, optionally identify its source item, and inspect its bonuses and remaining duration. Every definition needs an effect name and a **Stacking key**. Give related effects the same key: **additive** combines their bonuses, **highest** keeps the strongest value per target, and **replace** uses the latest application. Different keys work independently.

Activating an expired or inactive effect starts its duration again. Advancing effects by one round and advancing the solo tracker are alternative ways to move round durations forward; do not do both for the same round. Applying an effect does not consume its source item.

## Import, export, and bulk maintenance

Open the campaign **Import & export** tab to transfer library content. Use **Export YAML** for a whole-library copy or select sourcebooks for packages containing their source records and every keyed entry. Legacy citation-only entries are excluded from sourcebook packages. The export is not a character or campaign backup. The current format is version 15.

Use **Edit package** to stage related changes through controls without preparing a file. Start from the current library, choose categories and sourcebook scope, and add, edit or remove entries. Excluding a category keeps its current entries. Merge adds or updates; Replace also removes entries you removed from the selected scope. Include campaign settings only for a whole-library package; applying a package never renames the campaign. **Review package** checks the combined definitions and shows incoming and removal counts before confirmation. Removing an entry from the draft alone does not change the campaign.

Each entry and the package composer retain a subtle **Raw YAML** disclosure. It edits the same content as the typed fields. Invalid YAML remains editable and blocks saving or review until repaired. A valid raw replacement refreshes the typed controls. Package edits retain current-campaign enchantment links; portable **Export YAML** keeps their mechanics as independent snapshots.

A source-scoped package cannot discard changes made to entries outside its selected books: review names those entries so you can expand the scope or correct their source. New entries use the selected book automatically when exactly one is selected. Correct any invalid entry fields before editing the package’s raw YAML.


In **Import YAML**, select a file, choose the entire file or specific sourcebooks, choose a mode, inspect the preview, then confirm:

- **Merge** adds new identities and updates matching ones without deleting other entries. It can still overwrite matching definitions.
- **Replace** also removes existing entries absent from the uploaded sections. Use it only when the file is intended to be authoritative. A sourcebook Replace removes entries only from the selected books. Optional omitted sections are preserved; explicitly empty arrays request an empty section.

Imports match entries by their YAML `key` and source edition, plus kind for traits. Changing a YAML `key` can create a separate entry. Read the preview rather than assuming names alone control replacement. Review the campaign-settings option before importing settings along with content.

Mark a definition **Restricted** in its source and completeness editor to keep it GM-only. Players cannot browse, export or newly add it to characters; existing character copies continue to work. An older file that omits the restriction flag preserves existing restrictions on matching entries.

Library browsing and ordinary entry edits work from the local copy, including offline. **File and package imports require a connection.** Wait for ordinary edits to sync before exporting a server copy or coordinating a bulk import with another editor. Do not interpret an unsynced indicator as proof that a second device has the new content.

## Update existing content deliberately

Library changes and character purchases have different lifecycles. Linked mechanical definitions can refresh from the library; an existing character's resolved purchase price and selected pricing inputs remain recorded until that purchase is explicitly repriced.

When a price changes, inspect the existing trait or inventory editor and use its **Re-resolve pricing** workflow. Review the new inputs and result before accepting. A source deletion or campaign transfer can leave a retained copy rather than silently substituting another edition with the same name.

Before a campaign-wide correction, test one definition and one character. Compare the sheet, point ledger or inventory totals, and history. Check a new purchase as well as an older one; their prices need not change together.

## Troubleshoot an entry

**No Add or Edit controls:** confirm that you are the campaign owner and that the correct campaign is selected.

**Entry is saved but absent from a character picker:** check campaign assignment, completeness, content role, source edition, and search/filter settings. Try **Other sources** before making a duplicate.

**Save is unavailable:** check required fields and expanded advanced editors for validation messages. Invalid fields or YAML, or an incomplete specialization catalog, keep the form open; correct it before saving.

**Price did not change:** confirm that you selected **Use pattern**, or that the full calculation fields validate. For an existing character purchase, check whether explicit repricing is required.

**A described bonus is missing:** descriptions do not create effects. Check the structured effect, selector, condition, equipment state, and stacking policy. Test the underlying value before and after applying the effect.

**A saved value reverts:** inspect the error message and the header sync log. Resolve the rejected value or conflicting edit before retrying. Avoid repeatedly creating a new entry to work around a failed update.

**The source rule cannot be represented faithfully:** preserve a citation and explanation, leave unresolved definitions as **Needs review** or **Reference only**, and record the manual procedure. A partly automated rule should clearly identify which steps the player or GM still performs.

Sourcebooks need a publication title and abbreviation. Choose them from an entry's
**Sourcebook** picker, which shows the abbreviation followed by the title. Renaming
a book keeps its existing links. Source keys appear only in portable YAML files.
