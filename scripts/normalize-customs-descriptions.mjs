import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const customsPath = path.join(root, "data/dse-customs.json");
const customs = JSON.parse(fs.readFileSync(customsPath, "utf8"));

const descriptions = {
  "dse-1-0-battery-cables-1ft": ["iGreely", "1/0 AWG red/black battery cable", "1 ft"],
  "dse-1-0-battery-cables-2ft": ["iGreely", "1/0 AWG red/black battery cable", "2 ft"],
  "dse-10awg-duplex-wire": ["Unbranded", "10 AWG red/black duplex copper wire", "10 ft"],
  "dse-10awg-wire-30ft": ["iGreely", "10 AWG red/black wire", "30 ft"],
  "dse-14awg-wire-pair-25ft": ["Unbranded", "14 AWG red/black wire", "25 ft"],
  "dse-18awg-wire-pair-50ft": ["Unbranded", "18 AWG red/black wire", "50 ft"],
  "dse-2awg-wire-pair-5ft": ["Unbranded", "2 AWG red/black battery cable", "5 ft"],
  "dse-6awg-wire-10ft": ["iGreely", "6 AWG red/black wire", "10 ft"],
  "dse-8awg-ring-lugs": ["RED WOLF", "8 AWG ring lug", "5/16 in"],
  "dse-8awg-wire-10ft": ["iGreely", "8 AWG red/black wire", "10 ft"],
  "dse-aa-aaa-charger": ["EBL", "Universal AA/AAA battery charger", "USB-C"],
  "dse-ac-30a-rejected": ["DIHOOL", "GFCI breaker and Type 2 SPD assembly", "30 A · 30 mA"],
  "dse-ac-enclosure": ["Mollom", "HT-8 DIN enclosure", "8-way · 200 × 155 × 92 mm"],
  "dse-ac-rcbo": ["DIHOOL", "Two-pole ground-fault breaker with integrated surge protection", "10 A · 120–240 VAC · received safety markings pending"],
  "dse-airic-npt-cable-glands": ["AIRIC", "Waterproof cable-gland set", "3/4 in NPT"],
  "dse-amomd-600a-busbars-unused": ["AMOMD", "Covered positive/negative busbar pair", "600 A · returned · not in design"],
  "dse-balancers": ["Victron", "Battery Balancer", "BBA000100100"],
  "dse-battery-cable": ["Shirbly", "Preterminated 1/0 AWG OFC battery cable pairs", "3 × 1.5 ft pairs + 2 × 2 ft pairs · red / black · 3/8 in lugs"],
  "dse-battery-string-breakers": ["DIHOOL", "DZ47X-125-frame non-polarized single-pole breaker", "120 A · AC/DC"],
  "dse-b125-chtaixi-unused": ["CHTAIXI", "DZ47NZ-125 B125 single-pole breaker", "125 A · return pending"],
  "dse-battery-string-breakers-midnite-unused": ["MidNite Solar", "MNEPV125-80-1PNP breaker", "125 A · 80 VDC"],
  "dse-battery-terminal-clamps-additional": ["Unbranded", "Automotive battery-terminal connector", ""],
  "dse-breaker-mnedc100": ["DIHOOL", "DZ47X-125-frame non-polarized single-pole breaker", "120 A · AC/DC"],
  "dse-cable-cutters": ["Mutt Tools", "Cable cutters", "10 in"],
  "dse-cat6-blue-spare": ["StarTech", "Cat6 patch cable", "N6PATCH10BL · 10 ft · blue"],
  "dse-chargeit-mini-75": ["Coolgear", "ChargeIT! Mini USB module", "CG-PD60PPS · 75 W · USB-C + USB-A"],
  "dse-chtai-ac-rcbos-rejected": ["CHTAIXI", "TXB7sLE-63 C10 RCBO", "120 VAC · 30 mA · 1P+N · Type AC"],
  "dse-dielectric-grease": ["Permatex", "Dielectric Tune-Up Grease", "22058 · 3 oz"],
  "dse-din-rail-pack": ["mxuteuk", "DIN rail", "4 in"],
  "dse-earth-busbar": ["Blue Sea", "2128 MaxiBus", "250 A"],
  "dse-earth-minibus": ["Blue Sea", "2306 Mini Grounding BusBar", "100 A · six-gang"],
  "dse-ekrano-ethernet": ["StarTech", "Cat6 patch cable", "N6PATCH10RD · 10 ft · red"],
  "dse-ekrano-gx": ["Victron", "Ekrano GX", "BPP900480100"],
  "dse-ex-starlink": ["Starlink", "Mini Kit", "Hardware ID pending label"],
  "dse-extra-ac-rcbo-pair": ["DIHOOL", "Two-pole ground-fault breaker with integrated surge protection", "10 A · two duplicate units"],
  "dse-extra-dihool-120a-breaker": ["DIHOOL", "DZ47X-125-frame single-pole breaker", "120 A · surplus fourth unit"],
  "dse-ferrule-crimper-kit": ["Unbranded", "Ferrule crimper and ferrule assortment", ""],
  "dse-heavy-lug-assortment": ["Unbranded", "Heavy copper-lug assortment", ""],
  "dse-heavy-lug-kit-65": ["Glarks", "Heavy copper-lug assortment", ""],
  "dse-indoor-light": ["QHLightlux", "Utility light", "12–28 V · 3000 K · 900 lm · IP67"],
  "dse-inline-connectors": ["Oyviny", "Three-pole inline junction connector", "IP68"],
  "dse-klein-wire-stripper": ["Klein Tools", "Self-adjusting wire stripper/cutter", "11061"],
  "dse-kerwinn-shared-services-breaker-alternate": ["KERWINN", "Single-pole B-curve DC miniature circuit breaker", "10 A · 12–110 VDC · unselected alternate"],
  "dse-laptop-sleeve-additional": ["Thule", "Gauntlet laptop sleeve", "16 in"],
  "dse-light-spare": ["QHLightlux", "Utility light", "12–28 V · 3000 K · 900 lm · IP67"],
  "dse-main-busbars": ["Joinfworld", "Covered positive/negative main busbar pair", "250 A · four 3/8 in studs per bar · red / black"],
  "dse-mc4-connector-spares": ["MUYI", "MC4-compatible connector kit", ""],
  "dse-mc4-dc-adapters": ["zdyCGTime", "MC4-to-DC adapter cable", "5.5 × 2.1 mm · 1.5 m · 16 AWG"],
  "dse-mc4-tool-kit": ["MUYI", "MC4 assembly tool kit", ""],
  "dse-mppt-wirebox-mc4-rejected": ["Victron", "MPPT WireBox-XL MC4 VE.Can", "SCC950400300"],
  "dse-mppt-wirebox-tr": ["Victron", "MPPT WireBox-XL Tr", "SCC950400210"],
  "dse-mollom-8-way-enclosure-second": ["Mollom", "HT-8 DIN enclosure", "8-way · integration pending"],
  "dse-multimeter": ["Klein Tools", "MM325 digital multimeter", ""],
  "dse-multiplus": ["Victron", "MultiPlus-II 24/3000/70-32 230 V", "PMP242305010"],
  "dse-orion-usb-converter": ["Victron", "Orion-Tr Smart 24/12-30 A non-isolated", "ORI241236140 · 360 W"],
  "dse-orion-input-breaker": ["CHTAIXI", "Single-pole DC miniature breaker", "12–110 VDC · 32 A"],
  "dse-outdoor-light": ["QHLightlux", "Utility light", "12–28 V · 3000 K · 900 lm · IP67"],
  "dse-paint-markers": ["Unbranded", "Oil-based paint marker", "Black / white"],
  "dse-pv-breakers-32a-rejected": ["CHTAIXI", "DZ47NZ-63 two-pole PV breaker", "600 VDC · 32 A"],
  "dse-pv-protection": ["CXCESNS", "Two-string PV combiner", "600 VDC · 40 A · disconnect + SPD"],
  "dse-pv-string-breakers": ["CHTAIXI", "DZ47NZ-63 two-pole PV breaker", "600 VDC · 20 A"],
  "dse-pg11-cable-glands": ["Oimyalsi", "Waterproof nylon cable-gland kit", "PG11 · 25 pack"],
  "dse-chargeit-branch-breaker": ["CHTAIXI", "Single-pole DC miniature breaker", "12–110 VDC · 32 A"],
  "dse-ring-fork-terminals": ["haisstronica", "Insulated ring-and-fork terminal assortment", ""],
  "dse-room-switch": ["Unbranded", "Inline DPST cord switch", "IP67 · 12 V · red indicator"],
  "dse-router": ["Ubiquiti", "UniFi Express", "UX-US"],
  "dse-service-return-bus": ["Blue Sea", "2314 MiniBus", "100 A · covered"],
  "dse-service-return-bus-spares": ["Blue Sea", "2314 MiniBus", "100 A · covered"],
  "dse-shelf-brackets-additional": ["Unbranded", "Shelf bracket", ""],
  "dse-shunt": ["Victron", "SmartShunt IP65 500 A", "Part number pending label"],
  "dse-shirbly-2awg-cable-pairs": ["Shirbly", "Preterminated 2 AWG OFC battery cable pairs", "2 × 3 ft pairs · red / black · 3/8 in lugs"],
  "dse-smartsolar": ["Victron", "SmartSolar MPPT 150/85-Tr VE.Can", "SCC115085411"],
  "dse-spade-terminals": ["TICONN", "Insulated spade-terminal assortment", ""],
  "dse-starlink-ethernet": ["CHGRNLF", "Starlink Mini weatherproof Ethernet cable", "15 ft"],
  "dse-starlink-portable-battery-cable": ["SegurVelo", "Starlink Mini direct-battery power cable", "16.4 ft"],
  "dse-starlink-portable-usbc-cables": ["Genioss", "Starlink Mini USB-C PD power cable", "6.6 ft"],
  "dse-switched-load-breaker": ["CHTAIXI", "Single-pole B-curve DC miniature circuit breaker", "10 A · 12–110 VDC · delivery delayed"],
  "dse-switch-array": ["Unbranded", "Six-gang marine switch panel", "12/24 V"],
  "dse-switch-connectors": ["WAGO", "221 compact connector assortment", "221-2401 · 221-412 · 221-413 · 221-415"],
  "dse-twin-ferrule-kit": ["Preciva", "Twin-wire ferrule assortment", ""],
  "dse-type-i-notebook-cord-additional": ["Cable Leader", "AS/NZS 3112 Type I-to-IEC C5 power cord", "6 ft"],
  "dse-unifi-converter": ["YRDZXG", "DC-to-USB converter", "12/24 V input · 5 V / 5 A output"],
  "dse-unifi-usb-cable": ["Amazon Basics", "USB-C to USB-A 2.0 cable", "1.8 m"],
  "dse-unused-acer-card-readers": ["Acer", "Three-in-one USB-C SD card reader", "ODK4H0 · dual card slots · USB 3.0"],
  "dse-unused-galaxy-s24-case": ["Lanhiem", "Waterproof case for Galaxy S24", "IP68 · 6.2 in · light blue"],
  "dse-unused-galaxy-s24-pair": ["Samsung", "Galaxy S24", "SM-S921U1 · 256 GB · black · unlocked"],
  "dse-unused-macbook-air-15-m4": ["Apple", "15-inch MacBook Air (M4, 2025)", "512 GB · Midnight"],
  "dse-unused-sandisk-portable-ssd": ["SanDisk", "Portable SSD", "SDSSDE30-1T00-G26 · 1 TB · USB-C · USB 3.2 Gen 2"],
  "dse-usb": ["Coolgear", "CG-C145C-145W dual USB-C PD 3.1 charger", "145 W EPR"],
  "dse-usb-c-cables-240w": ["Cable Matters", "USB-C to USB-C charging cable", "240 W · 6 ft · white"],
  "dse-usb-c-cables-60w": ["Cable Matters", "USB-C to USB-C charging cable", "60 W · 6 ft · multicolor"],
  "dse-usb-output-breaker": ["CHTAIXI", "B60 single-pole DC breaker", "12–110 VDC"],
  "dse-usb-sockets": ["YCIND", "Female cigarette-lighter socket harness", "12 AWG · 6 ft"],
  "dse-usb-station-wiring": ["Various", "USB charging-station installation hardware", "Cable · mounting · terminations"],
  "dse-vebus-cable": ["StarTech", "Cat6 patch cable", "N6PATCH10YL · 10 ft · yellow · VE.Bus"],
  "dse-ventilated-ip65-enclosure": ["Unbranded", "Ventilated ABS electrical enclosure", "IP65 · grey cover · 11.9 × 11.9 × 7 in"],
  "dse-vedirect-cables": ["Victron", "VE.Direct cable", "ASS030530209 · 0.9 m"],
};

const metadataIds = Object.keys(customs.itemMeta).sort();
const descriptionIds = Object.keys(descriptions).sort();
const missing = metadataIds.filter((id) => !descriptions[id]);
const stale = descriptionIds.filter((id) => !customs.itemMeta[id]);
if (missing.length || stale.length) {
  throw new Error(`Customs description map mismatch. Missing: ${missing.join(", ") || "none"}; stale: ${stale.join(", ") || "none"}`);
}

for (const [id, [make, model, additionalInfo]] of Object.entries(descriptions)) {
  Object.assign(customs.itemMeta[id], { make, model, additionalInfo });
}
customs.miscGrouping = {
  ...customs.miscGrouping,
  explanation: "Combines every goods line below USD 30. The grouped description lists only each make and model; quantities, ASINs and references remain available in the on-screen disclosure.",
};

fs.writeFileSync(customsPath, `${JSON.stringify(customs, null, 2)}\n`);
console.log(JSON.stringify({ normalizedDescriptions: descriptionIds.length }, null, 2));
