/** Polowat-only planning choices; Fiji never imports these. */
export type PolowatLayout = { id:string; dinPosition:'top'|'bottom'; columns:number; minimumWidth:number; dinOrder:readonly string[]; backplateOrder:readonly string[] };
const buses=['positiveBus','negativeBus','loadPositiveBus','loadNegativeBus'];
const sources=['pvBreaker','controllerBreaker','batteryBreakerA','batteryBreakerB',...buses,'starlinkBreaker','usbBreaker'];
const batteries=['batteryBreakerA','batteryBreakerB',...buses,'controllerBreaker','pvBreaker','starlinkBreaker','usbBreaker'];
const loads=['starlinkBreaker','usbBreaker',...buses,'batteryBreakerA','batteryBreakerB','controllerBreaker','pvBreaker'];
const monitorFirst=['batteryShunt','monitorFuse','batteryMonitor','mppt','starlinkConverter','usbCharger'];
const convertersFirst=['mppt','starlinkConverter','usbCharger','batteryShunt','monitorFuse','batteryMonitor'];
export const polowatLayoutCandidates:readonly PolowatLayout[]=[
 {id:'top-sources-3',dinPosition:'top',columns:3,minimumWidth:.5,dinOrder:sources,backplateOrder:monitorFirst},
 {id:'bottom-sources-2',dinPosition:'bottom',columns:2,minimumWidth:.5,dinOrder:sources,backplateOrder:monitorFirst},
 {id:'bottom-sources-3',dinPosition:'bottom',columns:3,minimumWidth:.5,dinOrder:sources,backplateOrder:monitorFirst},
 {id:'bottom-batteries-3',dinPosition:'bottom',columns:3,minimumWidth:.5,dinOrder:batteries,backplateOrder:monitorFirst},
 {id:'bottom-loads-3',dinPosition:'bottom',columns:3,minimumWidth:.5,dinOrder:loads,backplateOrder:monitorFirst},
 {id:'bottom-converters-3',dinPosition:'bottom',columns:3,minimumWidth:.5,dinOrder:sources,backplateOrder:convertersFirst},
 {id:'bottom-wide-3',dinPosition:'bottom',columns:3,minimumWidth:.6,dinOrder:sources,backplateOrder:convertersFirst},
 {id:'bottom-wide-monitor-3',dinPosition:'bottom',columns:3,minimumWidth:.6,dinOrder:batteries,backplateOrder:monitorFirst},
];
export const selectedPolowatLayout=polowatLayoutCandidates.find(p=>p.id==='bottom-wide-monitor-3')!;

/** Non-polarized positions may exchange top/bottom connections without rotating the body. */
export const reversiblePolowatBreakers=["batteryBreakerA","batteryBreakerB","controllerBreaker"] as const;
export const selectedPolowatBreakerRouting:readonly string[]=["batteryBreakerA", "controllerBreaker"];
