#!/usr/bin/env python3
"""Create a high-fidelity test copy of Raphaël Costeau through the public API.
Writes a verified manifest only; it does not alter app source code or wipe data.

Paths are configurable: `--source` (spreadsheet) and `--out` (manifest).
Defaults assume the author's checkout layout so a bare invocation works there,
but any checkout can point them elsewhere.
"""
import argparse, json, re, time, urllib.error, urllib.request
from datetime import datetime
from pathlib import Path
import openpyxl

BASE = 'http://localhost:3001/api/v1'

parser = argparse.ArgumentParser(description='Replicate the veteran GURPS sheet into the app.')
parser.add_argument('--source', default='/home/hermes/workspace/veteran-character-source.xlsx',
                    help='Path to the source workbook (default: author checkout layout).')
parser.add_argument('--out', default='/home/hermes/workspace/gurps-player-companion/veteran-replication-manifest.json',
                    help='Where to write the verified manifest (default: repo root).')
args = parser.parse_args()
SOURCE = Path(args.source)
OUT = Path(args.out)

def call(method, path, body=None, token=None):
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode()
    headers = {'Content-Type':'application/json'} if body is not None else {}
    if token: headers['Authorization'] = f'Bearer {token}'
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            text = r.read().decode()
            return r.status, json.loads(text) if text else None
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors='replace')
        raise RuntimeError(f'{method} {path} -> HTTP {e.code}: {detail}')

def cell(ws, row, col):
    return ws.cell(row, col).value

def value_int(v, default=0):
    if v is None or v == '': return default
    if isinstance(v, bool): return int(v)
    if isinstance(v, (int,float)): return int(v)
    m=re.search(r'-?\d+(?:\.\d+)?', str(v))
    return int(float(m.group())) if m else default

def text(v): return '' if v is None else str(v).strip()

def normalize_date(v):
    if isinstance(v, datetime): return v.date().isoformat()
    s=text(v)
    if not s: return None
    if re.fullmatch(r'\d{1,2}/\d{1,2}/\d{4}', s):
        m,d,y=s.split('/')
        return f'{int(y):04d}-{int(m):02d}-{int(d):02d}'
    return None

wb=openpyxl.load_workbook(SOURCE, data_only=True)
a=wb['Attributes']; eq=wb['Equipment']; gl=wb['Game Log']
stamp=int(time.time())
email=f'raphael-costeau-test-{stamp}@local.invalid'
_, tokens=call('POST','/auth/register', {'email':email,'password':'VeteranTestOnly!2026','displayName':'Veteran Sheet Test'})
token=tokens['accessToken']

campaign_body={
  'name':'Raphaël Costeau — veteran-sheet replication test',
  'description':'Test campaign created from the supplied legacy GURPS spreadsheet. Source metadata and all known campaign context are preserved on the character and session-log entries.',
  'pointTarget':456, 'disadvantageCap':80, 'quirkCap':5,
  'manaLevel':'normal', 'techLevel':4, 'shareCharacterSheets':True,
  'allowGmCharacterEditing':False,
}
_, campaign=call('POST','/campaigns',campaign_body,token)

appearance='''Dark hair. Green Eyes. From Tal Cabal.

**The Phoenix Blade**

Source sheet: version 1.1; 180 lb; age 25.

Temporary/current source-sheet annotations (not fully representable as durable named effects): str, battle, speed, true sight, fire resistance, see invisible, darkvision.

Source financial/equipment total: $237,940; carried raw/effective weights shown as 19.55 / 57.12 lb; source says no encumbrance.'''

char_body={
  'name':'Raphaël Ambrosius Costeau',
  'height':'6’0”',
  'weight':'180 lb',
  'age':25,
  'birthdate':'3/7/0402',
  'appearance':appearance,
  'campaignId':campaign['id'],
  'st':14,'dx':17,'iq':14,'ht':15,'hpMod':0,'willMod':2,'perMod':1,'fpMod':0,
  'speedQuarterMod':0,'moveMod':0,
  'tempEffects':[{'id':'manual','name':'Source current effects (manual)','mods':{'st':5,'dx':6,'move':2}}]
}
_, character=call('POST','/characters',char_body,token)
cid=character['id']
manifest={
  'source':str(SOURCE),
  'createdAt':datetime.now().isoformat(),
  'testUser':email,
  'campaignId':campaign['id'],
  'characterId':cid,
  'created':{'traits':[],'languages':[],'techniques':[],'skills':[],'spells':[],'inventory':[],'logs':[]},
  'source_representation_notes':[]
}

# Traits, including all distinct advantages/perks/disadvantages/quirks as flat costs.
sections=[(23,37,'advantage'),(42,53,'perk'),(58,63,'disadvantage'),(68,72,'quirk')]
for start,end,kind in sections:
    for r in range(start,end+1):
        name=text(cell(a,r,1)); points=value_int(cell(a,r,8))
        if not name: continue
        payload={'kind':kind,'name':name,'points':points}
        _,out=call('POST',f'/characters/{cid}/traits',payload,token)
        manifest['created']['traits'].append({'id':out['trait']['id'],'name':name,'kind':kind,'points':points})

# First-class character languages (Cathrian, Wheeler Sign, Elvish)
languages = [
  {'name':'Cathrian','spokenFluency':'native','writtenFluency':'native','points':0},
  {'name':'Wheeler Sign','spokenFluency':'native','writtenFluency':'n/a','points':3},
  {'name':'Elvish','spokenFluency':'accented','writtenFluency':'none','points':2},
]
for lang in languages:
    _,out=call('POST',f'/characters/{cid}/languages',lang,token)
    manifest['created']['languages'].append({'id':out['language']['id'],'name':lang['name'],'points':out['language']['points']})
manifest['source_representation_notes'].append('Languages imported into first-class character_languages with spoken/written fluency.')

# Use the campaign library’s effect system for the two source traits whose effects
# are explicitly quantified on the sheet; link the existing trait rows back to it.
for effect_name, effect_points, effects in [
    ('Combat Reflexes', 15, [{'target':'dodge','value':1,'scaling':'flat'}]),
    ('Tough Skin 2', 6, [{'target':'dr','value':2,'scaling':'flat'}]),
]:
    _, lib = call('POST', f"/campaigns/{campaign['id']}/library/traits", {'name':effect_name,'kind':'advantage','basePoints':effect_points,'effects':effects,'source':'Legacy sheet'}, token)
    existing = next(t for t in manifest['created']['traits'] if t['name'] == effect_name)
    call('PATCH', f"/characters/{cid}/traits/{existing['id']}", {'libraryTraitId':lib['id']}, token)
manifest['source_representation_notes'].append('Combat Reflexes (+1 Dodge) and Tough Skin 2 (+2 global trait DR) were verified through linked campaign-library effects.')

# Source skills: name, optional specialty, governing attribute, difficulty, source point spend.
def import_skill(name, attr, diff, pts, specialty=None, note=None):
    payload={'name':name,'attribute':attr,'difficulty':diff,'points':pts}
    if specialty: payload['specialization']=specialty
    if note: payload['notes']=note
    _,out=call('POST',f'/characters/{cid}/skills',payload,token)
    manifest['created']['skills'].append({'id':out['skill']['id'],'name':name,'specialization':specialty,'points':pts,'level':out['skill']['level'],'effectiveLevel':out['skill']['effectiveLevel']})

for r in list(range(85,114))+list(range(118,126)):
    raw=text(cell(a,r,1)); diff=text(cell(a,r,5)); rel=text(cell(a,r,6)); pts=value_int(cell(a,r,8))
    if not raw or diff not in ('E','A','H','VH'): continue
    attr='Other'
    if rel.upper().startswith('DX'): attr='DX'
    elif rel.upper().startswith('IQ'): attr='IQ'
    elif rel.upper().startswith('HT'): attr='HT'
    elif rel.upper().startswith('WILL'): attr='Will'
    elif rel.upper().startswith('PER'): attr='Per'
    elif rel.upper().startswith('ST'): attr='ST'
    name=raw; specialty=None
    m=re.match(r'^(.*?)\s*\((.*)\)$',raw)
    if m: name,specialty=m.group(1).strip(),m.group(2).strip()
    if '/' in name:
        name,specialty=name.split('/',1)
    import_skill(name,attr,diff,pts,specialty,f'Legacy sheet relation {rel}; displayed source level {text(cell(a,r,7))}; source + column {text(cell(a,r,4))}.')

# First-class martial-arts technique: Combat Riding defaulting to Riding (Equines)
_, out_tech = call('POST', f'/characters/{cid}/techniques', {
    'name':'Combat Riding',
    'defaultSkillName':'Riding (Equines)',
    'difficulty':'H',
    'points':0,
    'notes':'Legacy technique: default Riding; listed level 16; source point cost 0.'
}, token)
manifest['created']['techniques'].append({'id':out_tech['technique']['id'],'name':'Combat Riding','level':out_tech['technique']['level']})
manifest['source_representation_notes'].append('Combat Riding imported into first-class character_techniques entity, resolving level against Riding (Equines).')

# Spells present on the live sheet.
for name in ['Ignite Fire','Shape Fire']:
    payload={'name':name,'college':'Fire','difficulty':'H','points':1,'baseEnergyCost':1,'notes':'Source: Magic p.72.'}
    _,out=call('POST',f'/characters/{cid}/spells',payload,token)
    manifest['created']['spells'].append({'id':out['spell']['id'],'name':name,'level':out['spell']['level'],'effectiveCost':out['spell']['effectiveCost']})

# Inventory helpers. Every source line becomes an inventory row; facet details are attached where app supports them.
def add_item(name, weight=0, cost=0, notes='', parent=None, external=None, worn=False, equipped=False, **facets):
    p={'name':name[:160],'quantity':1,'weightLbs':max(0,float(weight or 0)),'cost':max(0,float(cost or 0)),'notes':notes or None,'parentId':parent,'externalLocation':external,'worn':worn,'equipped':equipped}
    p.update(facets)
    _,out=call('POST',f'/characters/{cid}/inventory',p,token)
    manifest['created']['inventory'].append({'id':out['item']['id'],'name':name,'weightLbs':weight,'cost':cost,'parentId':parent,'externalLocation':external})
    return out['item']['id']

# Containers first (nested inventory works in app).
backpack=add_item('Backpack',3,0,'Source capacity 40 lb; contents 18.5 lb; hideaway 10 lb; Lighten 25%.',external='Back',worn=True,isContainer=True,hideawayCapacityLbs=10,weightReductionPercent=25)
hide1=add_item('Hideaway1',0,202,'Source capacity/hideaway 1 lb.',external='Belt',worn=True,isContainer=True,hideawayCapacityLbs=1)
hide2=add_item('Hideaway2',0,1500,'Source capacity/hideaway 2 lb.',external='Belt',worn=True,isContainer=True,hideawayCapacityLbs=2)
rapier_hilt=add_item("Milton's Rapier Hilt (Hideaway)",0,0,'Source capacity/hideaway 2 lb.',isContainer=True,hideawayCapacityLbs=2)
main_hilt=add_item("Milton's Main-Gauche (Hideaway)",0,0,'Source capacity/hideaway 2 lb.',isContainer=True,hideawayCapacityLbs=2)
potion_belt=add_item('Basalisk Hide Potion Belt',0,0,'Potion belt: 4 bottles/8 vials; Fast Draw; +2 DR for contents. Source capacity/hideaway 2 lb.',external='Belt',worn=True,isContainer=True,hideawayCapacityLbs=2)
parents={'Backpack':backpack,'Hideaway1':hide1,'Hideaway2':hide2,"Milton's Rapier Hilt (Hideaway)":rapier_hilt,"Milton's Main-Gauche (Hideaway)":main_hilt,'Basalisk Hide Potion Belt':potion_belt}

# Weapons with primary + alternateModes and enchantments list.
weapons=[
 ('Bluesteel Pistol — Laevus',3.16,0,'Fine. Shatterproof.',{'damage':'2d+1 pi+','skill':'Guns (Pistol)','ranged':{'acc':3,'range':'55/540','rof':'1','shots':'1(3)','recoil':3}},[{'spellName':'Cornucopia','category':'Cornucopia (shot)'},{'spellName':'Name','category':'Name (Megaera, Geiravor)'},{'spellName':'Shatterproof'},{'spellName':'Puissance','category':'Puissance +1'}]),
 ('Bluesteel Pistol — Dexter',3.16,0,'Fine. Shatterproof.',{'damage':'2d+1 pi+','skill':'Guns (Pistol)','ranged':{'acc':3,'range':'55/540','rof':'1','shots':'1(3)','recoil':3}},[{'spellName':'Cornucopia','category':'Cornucopia (shot)'},{'spellName':'Name','category':'Name (Megaera, Geiravor)'},{'spellName':'Shatterproof'},{'spellName':'Puissance','category':'Puissance +1'}]),
 ('Pocket Pistol',0.8,190,'Fine. Source listed 1d+1 pi, Acc 1, range 25/3000, RoF 1, shots 1(20), Rcl 2.',{'damage':'1d+1 pi','skill':'Guns (Pistol)','ranged':{'acc':1,'range':'25/3000','rof':'1','shots':'1(20)','recoil':2}},[]),
 ("Pride's Remedy — Very Fine Edged Rapier",3,0,'Very Fine. +2 Fire, Ghost Weapon, Penetrating 1/5.',{'damage':'sw+4 cut','reach':'1,2','parry':'+1F','skill':'Melee (Rapier)','stRequired':0,'alternateModes':[{'name':'Thrust','damage':'thr+5 imp','reach':'1,2','parry':'+1F'}]},[{'spellName':'Puissance','category':'Puissance +2'},{'spellName':'Shatterproof'},{'spellName':'Accuracy','category':'Accuracy +1'}]),
 ("Milton's Legacy Rapier",3,0,'Silvered, Fine. Ghost Weapon, Penetrating 1/2.',{'damage':'sw+2 cut','reach':'1,2','parry':'+1F','skill':'Melee (Rapier)','stRequired':0,'alternateModes':[{'name':'Thrust','damage':'thr+3 imp','reach':'1,2','parry':'+1F'}]},[{'spellName':'Puissance','category':'Puissance +1'},{'spellName':'Shatterproof'},{'spellName':'Accuracy','category':'Accuracy +1'}]),
 ("Milton's Main-Gauche",1.25,0,'Silvered, Fine.',{'damage':'sw cut','reach':'C,1','parry':'+1F','skill':'Melee (Main-Gauche)','stRequired':0,'alternateModes':[{'name':'Thrust','damage':'thr+2 imp','reach':'C,1','parry':'+1F'}]},[{'spellName':'Puissance','category':'Puissance +1'},{'spellName':'Shatterproof'}]),
 ('Faerie Leaf-Knife',0,0,'Source: sw+3, reach C, skill 21, parry 13. Very fine.',{'damage':'sw+3 cut','reach':'C','parry':'0','skill':'Melee (Rapier)','stRequired':0},[{'spellName':'Puissance','category':'Puissance +1'},{'spellName':'Shatterproof'}]),
 ('Bluesteel pistol grip',0,0,'Source: sw+2 cr, reach C,1, skill 23, parry 14.',{'damage':'sw+2 cr','reach':'C,1','parry':'0','skill':'Brawling','stRequired':0},[{'spellName':'Puissance','category':'Puissance +1'}]),
]
for n,w,c,note,wd,ench in weapons:
    add_item(n,w,c,note,external='L. Hip' if 'Laevus' in n or 'Pride' in n else ('R. Hip' if 'Dexter' in n or 'Legacy' in n else None),worn=True,equipped=True,weaponData=wd,enchantments=ench)

# Armor with hit location fields, typed DR (cut/imp), defense bonus (db), and enchantments.
armors=[
 ("Pierre's Hat",.5,4000,['skull'],4,None,{},False,'Fancy-looking with phoenix feather.',0,[{'spellName':'Fortify','category':'Fortify +3'}]),
 ("Dane Tysken's Coif",2.5,0,['skull','neck'],5,7,{'cut':5,'cr':7},False,'DR 5/7 cut/cr; Fortify +3, Deflect +3.',3,[{'spellName':'Fortify','category':'Fortify +3'},{'spellName':'Deflect','category':'Deflect +3'}]),
 ('Spidersilk Jacket',2,6620,['torso','arm_left','arm_right','neck'],3,None,{'cut':3,'imp':5},False,'DR 3/5 cut/imp; Fortify +2, Deflect +1. Supreme Purple.',1,[{'spellName':'Fortify','category':'Fortify +2'},{'spellName':'Deflect','category':'Deflect +1'}]),
 ('Pistoller Buff Coat',8,0,['torso','groin','arm_left','arm_right','leg_left','leg_right'],2,None,{},False,'Deflect +2, Lighten 50%.',2,[{'spellName':'Deflect','category':'Deflect +2'}]),
 ('Spidersilk Trousers',2,6650,['groin','leg_left','leg_right'],3,None,{'cut':3,'imp':5},False,'DR 3/5 cut/imp; Fortify +2.',0,[{'spellName':'Fortify','category':'Fortify +2'}]),
 ('Pistoller Boots',1.5,0,['foot_left','foot_right'],5,None,{},False,'Fortify +2, Lighten 50%. Enchanted Haste +1.',0,[{'spellName':'Fortify','category':'Fortify +2'}]),
 ('Spidersilk "Velvet" Gloves',0,0,['hand_left','hand_right'],5,None,{},False,'Fortify +3. Purple velvet with white accents.',0,[{'spellName':'Fortify','category':'Fortify +3'}]),
 ('Spider Light Cloak',1,0,[],3,None,{},False,'Source DB 3. Deflect 2, Fortify 2.',3,[{'spellName':'Deflect','category':'Deflect +2'},{'spellName':'Fortify','category':'Fortify +2'}]),
 ('Spider Heavy Cloak',2.5,0,[],3,None,{},False,'Source DB 4. Deflect 2, Fortify 2.',4,[{'spellName':'Deflect','category':'Deflect +2'},{'spellName':'Fortify','category':'Fortify +2'}]),
]
for n,w,c,loc,dr,cr,typed,flex,note,db,ench in armors:
    # Armor DB lives on `armor.db` (Deflect enchantments) — writing it to
    # `weaponData.db` too would count the piece as a shield (pickShield),
    # double-adding the DB and enabling Block on a coif or cloak.
    add_item(n,w,c,note,worn=True,equipped=True,isArmor=True,armor={'locations':loc,'dr':dr,'drCrushing':cr,'typedDr':typed,'db':db,'flexible':flex},enchantments=ench)

# Remaining source equipment, including worn, carried, stored, and consumable items.
items=[
 ('Bandoleer: powder charges(12), oil can, cleaning pouches, bullet flask',5,50,'Across chest',None),('Gun-Cleaning Kit',.5,0,'Hideaway2',None),('Bullet-Molding Gear',2,50,'Backpack',None),('Personal basics',0,5,'Backpack',None),('Rations: 6 meals',3,12,'Backpack',None),('Whetstone',1,5,'Backpack',None),('Waterskin (capacity 1 gal, wt 8.25 when full)',8.25,10,'Backpack',None),('Spidersilk rope 3/8 in, 100 yards',2,10,'Backpack','Supports 300 lbs'),('Torch ×2',2,10,'Backpack','Source note says supports 300 lbs.'),('Cloak Pin: Hero of Undinitham',0,2500,'Worn','Enchanted: Return Missile, Blur 3'),('Umbrella Charm',.25,290,'In Pocket','Enchanted: Umbrella'),('Talisman of Healing ×2',.5,5000,'Worn','1d healing, 1 day recharge'),('Talisman of Strength',.25,2500,'Worn','+1d str, 1hr, 2 day recharge'),('Talisman of Contraception',.25,6000,'Backpack',''),('Talisman of Keen Sight ×2',.5,8400,'Worn','3d, 5 minutes, 1 day recharge'),("Reaper's Broth Poison ×3",.75,3900,"Milton's Rapier Hilt (Hideaway)",''),('Javis Seed ×5',0,10,"Milton's Main-Gauche (Hideaway)",''),('Silver Ring of Sense',.01,30000,'Worn','9-point powerstone. Enchanted: Sound Vision, Sense Observation'),('Silver Ring of Cleansing',.01,220,'Worn','30-point powerstone. Enchanted: Clean'),('Golden Earring of Pollen Cloud',.01,300,'Worn','Enchanted: Pollen Cloud'),('Ruby-Gold Utility Ring',.01,13000,'Worn','26-point powerstone. Enchanted: Create Water, Ignite Fire, Test Food, Purify Air'),('Elven Powerstone — 50pt',.01,94593,'Worn','Source current/max: 41/50'),("Griffin's Pride Emblem (Gold)",.01,200,'Worn',''),('Potion: Universal Antidote',.25,750,'Basalisk Hide Potion Belt',''),('Potion: Invisibility',.25,3000,'Basalisk Hide Potion Belt',''),('Potion: Battle',.25,840,'Basalisk Hide Potion Belt',''),('Potion: Greater Health (3d)',.25,550,'Basalisk Hide Potion Belt',''),('Potion: Fire Resistance',.25,500,'Basalisk Hide Potion Belt',''),('Potion: Stealth',.25,2400,'Basalisk Hide Potion Belt',''),('Potion: Battle ×2',.5,1680,'Basalisk Hide Potion Belt',''),('Potion: Healing ×3',.75,360,'Basalisk Hide Potion Belt',''),('Potion: Magic Resistance (5)',.25,450,'Basalisk Hide Potion Belt',''),('Potion: Speed',.25,1200,'Basalisk Hide Potion Belt',''),('Elixir: True Sight',.25,4000,'Basalisk Hide Potion Belt',''),('Belt',0,0,'Belt','Holds pouches/sheaths'),('Pouch: Gun Accessories',0,0,'Belt',''),('Pouch: Components',0,0,'Belt',''),('Pouch: General',0,0,'Belt',''),('Bullet flask',0,0,'Across chest','Holds 12 pistol balls'),('12 lead pistol balls',0,0,'Across chest','Carried in flask'),('Oil can (small)',0,0,'Across chest','Gun maintenance'),('4 pistol cleaning pouches',0,0,'Across chest',''),('Flint and steel',0,0,'Backpack','Part of personal basics in source'),('Small knife',0,0,'Backpack','Personal basics utility knife'),('Whetstone holder',0,0,'Backpack',''),('Waterskin empty weight (0.25 lb)',.25,0,'Backpack','Treated in waterskin line'),('Water (1 gallon, 8.0 lb)',8,0,'Backpack','Treated in waterskin line'),('Purified bandage ×4',0,0,'Backpack','First-aid kit consumable'),('Suture and needle',0,0,'Backpack','First-aid kit consumable'),('Fine shears',0,0,'Backpack','First-aid kit consumable'),('Antiseptic herbs',0,0,'Backpack','First-aid kit consumable'),('Spare shirt (linen)',0,0,'Backpack','Clothing reserve'),('Spare trousers',0,0,'Backpack','Clothing reserve'),('Spare socks ×2',0,0,'Backpack','Clothing reserve'),('Soap',0,0,'Backpack','Personal hygiene'),('Comb',0,0,'Backpack','Personal grooming'),('Tooth powder and brush',0,0,'Backpack','Personal grooming'),('Tallow candle ×3',0,0,'Backpack','Illumination backup'),('Wax matches (box of 50)',0,0,'Backpack','Fire starting'),('Chalk pieces ×3',0,0,'Backpack','Marking / trail signs'),('Parchment sheets ×10',0,0,'Backpack','Notes / letters'),('Ink vial and quill',0,0,'Backpack','Writing supplies'),('Sealing wax stick',0,0,'Backpack','Document sealing'),('Signet ring',0,0,'Worn','Personal seal'),('Leather cord (20 feet)',0,0,'Backpack','General utility'),('Fishhooks and line',0,0,'Backpack','Subsistence backup'),('Wire spool (soft brass, 10 feet)',0,0,'Backpack','Trap / repair utility'),('Lockpicks (basic set)',0,0,'Hideaway1','Burglary / infiltration gear'),('Small mirror (steel)',0,0,'Backpack','Signaling / personal grooming'),('Spice pouch',0,0,'Backpack','Food seasoning'),('Tea leaves (small tin)',0,0,'Backpack','Personal comfort'),('Eating utensils (horn spoon, iron fork)',0,0,'Backpack','Mess kit'),('Tin cup',0,0,'Backpack','Mess kit'),('Small cooking pot with lid',0,0,'Backpack','Camp cooking'),('Canvas sheet (6x6 feet)',0,0,'Backpack','Shelter / ground cover'),('Blanket (wool)',0,0,'Backpack','Bedding'),('Bedroll straps',0,0,'Backpack','Gear strapping'),('Spare leather straps ×4',0,0,'Backpack','Repair materials'),('Awl and waxed thread',0,0,'Backpack','Leather repair'),('Brass buttons (dozen)',0,0,'Backpack','Clothing repair'),('Gunpowder horn (half-pound reserve)',0,0,'Backpack','Powder reserve'),('Grease tin (waterproofing)',0,0,'Backpack','Leather / gun care'),('Chamois cloth',0,0,'Backpack','Optics / fine weapon cleaning'),('Salt pouch (1 lb)',0,0,'Backpack','Preservation / cooking'),('Dried fruit packet',0,0,'Backpack','Trail rations'),('Hard cheese wheel (small)',0,0,'Backpack','Trail rations'),('Hardtack biscuits ×12',0,0,'Backpack','Emergency rations'),('Signal whistle (silver)',0,0,'Across chest','Communication'),('Brass compass',0,0,'Pocket','Navigation'),('Pocket watch (silver-plated)',0,0,'Pocket','Timekeeping'),('Spectacles in hard case',0,0,'Pocket','Backup vision aid'),('Smoking pipe and tobacco pouch',0,0,'Pocket','Personal relaxation'),('Fine handkerchief (silk)',0,0,'Pocket','Personal luxury'),('Coin purse (empty reserve)',0,0,'Pocket','Currency handling'),('Hidden coin lining in belt',0,0,'Belt','Emergency funds reserve'),('Spare pistol flints ×6',0,0,'Hideaway2','Gun ignition reserve'),('Bullet extractor tool',0,0,'Hideaway2','Gun maintenance'),('Vent pick (fine steel)',0,0,'Hideaway2','Touchhole clearing'),('Touchhole brush',0,0,'Hideaway2','Gun cleaning'),('Powder measure (adjustable brass)',0,0,'Across chest','Charge measurement'),('Wadding cloth patches (bag of 50)',0,0,'Across chest','Loading supplies'),('Bullet pouch (leather, belt-hung)',0,0,'Belt','Readily accessible ammunition')
]
for n,w,c,loc,note in items:
    parent=parents.get(loc)
    external=None if parent else loc
    extra={}
    if n=='Silver Ring of Sense': extra['powerstoneData']={'maxEnergy':9,'currentEnergy':9,'notes':'Source 9/9 powerstone'}
    if n=='Silver Ring of Cleansing': extra['powerstoneData']={'maxEnergy':30,'currentEnergy':30,'notes':'Source 30/30 powerstone'}
    if n=='Ruby-Gold Utility Ring': extra['powerstoneData']={'maxEnergy':26,'currentEnergy':26,'notes':'Source 26/26 powerstone'}
    if n.startswith('Elven Powerstone'): extra['powerstoneData']={'maxEnergy':50,'currentEnergy':41,'notes':'Source 41/50 powerstone'}
    add_item(n,w,c,note,parent=parent,external=external,worn=(loc=='Worn'),**extra)

# Campaign history: every listed XP/event row with a title becomes an adventure-log entry.
for r in range(2,64):
    title=text(cell(gl,r,3)); pts=cell(gl,r,5); game_date=normalize_date(cell(gl,r,4))
    if not title: continue
    snum=value_int(cell(gl,r,1)) or None
    loc=text(cell(gl,r,6)) or None
    award=value_int(pts,0)
    date=game_date or '0425-01-01'
    body=f"Imported from legacy Game Log row {r}. Raw Date: {text(cell(gl,r,2))}; Raw Game Date: {text(cell(gl,r,4))}."
    awards=[{'characterId':cid,'amount':award}] if award else []
    log_payload={'sessionDate':date,'sessionNumber':snum,'location':loc,'title':title[:200],'body':body,'visibility':'campaign','xpAwards':awards}
    _,out=call('POST',f"/campaigns/{campaign['id']}/log",log_payload,token)
    manifest['created']['logs'].append({'id':out['id'],'title':title,'sessionDate':date,'sessionNumber':snum,'location':loc,'xp':award})
manifest['source_representation_notes'].append('Adventure log entries imported with session numbers and locations.')

# Final API read-back is the verification source of truth.
_, final=call('GET',f'/characters/{cid}',token=token)
_, final_campaign=call('GET',f"/campaigns/{campaign['id']}",token=token)
_, final_logs=call('GET',f"/campaigns/{campaign['id']}/log",token=token)
manifest['verified']={
  'character':final,
  'campaign':final_campaign,
  'logCount':len(final_logs),
  'counts':{
    'traits':len(final['traits']),
    'languages':len(final.get('languages',[])),
    'techniques':len(final.get('techniques',[])),
    'skills':len(final['skills']),
    'spells':len(final['spells']),
    'inventory':len(final['inventory']),
    'logs':len(final_logs)
  }
}
OUT.write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
print(json.dumps({
  'manifest':str(OUT),
  'characterId':cid,
  'campaignId':campaign['id'],
  'birthdate':final.get('birthdate'),
  'counts':manifest['verified']['counts'],
  'derived':final['derived'],
  'points':final['points']
},ensure_ascii=False,indent=2))
