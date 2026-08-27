import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
const write = (name, value) => fs.writeFileSync(path.join(root, name), `${JSON.stringify(value, null, 2)}\n`);
const system = read("data/dse-system.json");
const customs = read("data/dse-customs.json");

const sources = {
  chtaixi: "https://www.chtaixi.com/contact",
  dihool: "https://www.dihool.net/",
  coolgear145: "https://www.coolgear.com/product/145w-dual-usb-c-pd-3-1-vehicle-charger-with-mountable-flanges",
  coolgear75: "https://www.coolgear.com/product/usb-car-charger-board-60w-high-power-pcb-ccg3pa",
  klein11061: "https://www.grainger.com/product/KLEIN-TOOLS-Wire-Stripper-Auto-58UR30",
  kleinMm325: "https://www.mouser.com/ProductDetail/Klein-Tools/MM325",
  midnite: "https://www.midnitesolar.com/doc_prod_list.php?menuItem=products&productCat_ID=17",
  startech: "https://www.directdial.com/us/item/startech-com-10ft-cat6-ethernet-cable/n6patch10yl",
  thule: "https://www.thule.com/en-ca/laptop-bags-sleeves/laptop-sleeves-and-cases/thule-gauntlet-macbook-pro-attache-16-_-3205415",
  ubiquiti: "https://www.adiglobaldistribution.us/Product/KX-UXUS",
  wago: "https://todistribution.co.za/wp-content/uploads/2021/07/Data_Sheet221-413_19.07.2021.pdf",
  amazonBasics: "https://m.media-amazon.com/images/I/B1pqHcZKsLL.pdf",
};

const known = new Map();
const assign = (ids, origin, basis, sourceUrl, note) => {
  for (const id of ids) known.set(id, { origin, originBasis: basis, originSourceUrl: sourceUrl, originNote: note });
};

assign(
  ["dse-chtai-ac-rcbos-rejected", "dse-battery-string-breakers", "dse-pv-string-breakers", "dse-pv-breakers-32a-rejected", "dse-breaker-mnedc100", "dse-switched-load-breaker", "dse-usb-output-breaker"],
  "CN", "manufacturer", sources.chtaixi,
  "TAIXI identifies its manufacturing operation and address in Zhejiang, China; verify the received product label before filing.",
);
assign(
  ["dse-ac-30a-rejected"],
  "CN", "manufacturer", sources.dihool,
  "DIHOOL identifies DIHOOL Electric Zhejiang Co., Ltd. as its manufacturer in Zhejiang, China; verify the received product label before filing.",
);
assign(["dse-usb"], "CN", "manufacturer", sources.coolgear145, "The exact Coolgear product listing states Country of Origin: China.");
assign(["dse-chargeit-mini-75"], "CN", "manufacturer", sources.coolgear75, "The exact Coolgear CG-PD60PPS product listing states Country of Origin: China.");
assign(["dse-klein-wire-stripper"], "TW", "listing", sources.klein11061, "The industrial distributor listing for Klein 11061 states Taiwan; verify the received package because origin is subject to change.");
assign(["dse-multimeter"], "CN", "listing", sources.kleinMm325, "The distributor compliance record for Klein MM325 states CN.");
assign(["dse-battery-string-breakers-midnite-unused", "dse-breaker-mnepv20"], "US", "manufacturer", sources.midnite, "MidNite product documentation identifies the relevant breaker family as made in the USA; verify the received label.");
assign(["dse-vebus-cable", "dse-ekrano-ethernet", "dse-cat6-blue-spare"], "CN", "listing", sources.startech, "The product-family distributor record states China; verify each received package revision.");
assign(["dse-laptop-sleeve-additional"], "CN", "manufacturer", sources.thule, "Thule's product specification states Country of origin: China.");
assign(["dse-router"], "CN", "listing", sources.ubiquiti, "The UX-US distributor listing states China; origin is subject to change.");
assign(["dse-switch-connectors"], "DE", "datasheet", sources.wago, "The WAGO 221-413 datasheet states country of origin DE.");
assign(["dse-unifi-usb-cable"], "CN", "manufacturer", sources.amazonBasics, "Amazon Basics product documentation states Made in China; verify the exact received cable package.");

const importedPhysical = system.bom.filter((row) => row.location === "Import" && row.totalWeightKg > 0);
for (const [id, meta] of Object.entries(customs.itemMeta)) {
  const row = system.bom.find((candidate) => candidate.id === id);
  if (!row) throw new Error(`Missing BOM row for customs metadata ${id}`);
  const researched = known.get(row.id);
  Object.assign(meta, researched ?? {
    origin: "",
    originBasis: "unresolved",
    originNote: "Product listing was reviewed first, followed by available manufacturer/datasheet material; no reliable product-specific manufacturing origin was published. Display as N/A until the label or invoice confirms it.",
  });
  if (!researched && (row.productUrl || row.specUrl)) meta.originSourceUrl = row.productUrl || row.specUrl;
  if (!meta.originSourceUrl) delete meta.originSourceUrl;
  meta.originReviewedOn = "2026-08-25";
}
for (const row of importedPhysical) if (!customs.itemMeta[row.id]) throw new Error(`Missing customs metadata for imported physical row ${row.id}`);

const defaultSerials = {
  "dse-router": "942A6F249E89",
  "dse-ekrano-gx": "HQ2509RURDF",
  "dse-orion-usb-converter": "HQ2524CKDAW",
  "dse-smartsolar": "HQ2522V4MVF",
  "dse-shunt": "HQ2301TYFRT",
  "dse-ex-starlink": "",
  "dse-unused-galaxy-s24-pair": "RFCWC04EX2V (IMEI 1: 353690625019873; IMEI 2: 354376945019871); RFCWCOXMNKK (IMEI 1: 353690625388534; IMEI 2: 354376945388532)",
  "dse-unused-macbook-air-15-m4": "LKQVK4R7LF; Wi-Fi MAC: 1c:f6:4c:a8:14:70",
};
for (const [id, serials] of Object.entries(defaultSerials)) {
  if (!customs.itemMeta[id]) throw new Error(`Missing customs metadata for serialized item ${id}`);
  customs.itemMeta[id].defaultSerials = serials;
}

delete customs.originDisplayDefault;
Object.assign(customs, {
  defaultConsignee: "Drua Sailing Experiences Pte Limited",
  defaultConsigneeTin: "2900306318",
  defaultBusinessRegistrationNumber: "2020RC000914",
  defaultTraveler: "Kyle McDonald",
  defaultFlight: "FJ811",
  defaultArrivalDate: "2026-08-30",
  defaultDestination: "Fulaga, Lau Group",
});
customs.miscGrouping = {
  label: "Miscellaneous Electrical Accessories",
  maximumLineUsd: 30,
  explanation: "Combines every goods line below USD 30. The grouped description lists every item name; quantities, ASINs and references remain available in the on-screen disclosure.",
};
customs.checkedOn = "2026-08-25";

const staleMeta = Object.keys(customs.itemMeta).filter((id) => !system.bom.some((row) => row.id === id));
if (staleMeta.length) throw new Error(`Stale customs metadata: ${staleMeta.join(", ")}`);
const invalidOrigins = Object.entries(customs.itemMeta).filter(([, meta]) => meta.origin && !/^[A-Z]{2}$/.test(meta.origin));
if (invalidOrigins.length) throw new Error(`Origins must be blank or ISO alpha-2 codes: ${invalidOrigins.map(([id]) => id).join(", ")}`);
write("data/dse-customs.json", customs);

const knownCount = importedPhysical.filter((row) => customs.itemMeta[row.id].origin).length;
console.log(JSON.stringify({ reviewed: importedPhysical.length, known: knownCount, unresolved: importedPhysical.length - knownCount }, null, 2));
