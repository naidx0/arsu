// Material Symbols (Rounded), bundled as SVG so they are there with no signal.
const files = import.meta.glob<string>([
  '/node_modules/@material-symbols/svg-400/rounded/{add,arrow_back,arrow_forward,call,cardiology,check,check_circle,chevron_right,close,cloud_done,cloud_off,dark_mode,delete,ecg_heart,emergency,error,favorite,graphic_eq,groups,healing,health_and_safety,home,info,light_mode,location_on,medication,mic,monitor_heart,person,photo_camera,pill,play_arrow,pulmonology,refresh,schedule,school,search,settings,shield_with_heart,sick,smart_toy,stethoscope,stop,sync,touch_app,translate,verified_user,vital_signs,volume_up,warning,wifi_off,auto_awesome,expand_more,done_all,local_hospital,memory,document_scanner,metronome,lock}.svg',
  '/node_modules/@material-symbols/svg-400/rounded/{call,cardiology,check_circle,cloud_done,cloud_off,ecg_heart,emergency,error,favorite,groups,healing,health_and_safety,home,info,location_on,medication,mic,monitor_heart,person,photo_camera,pill,play_arrow,pulmonology,schedule,school,shield_with_heart,sick,smart_toy,stethoscope,stop,verified_user,vital_signs,volume_up,warning,wifi_off,auto_awesome,local_hospital,memory,lock}-fill.svg',
], { query: '?raw', import: 'default', eager: true });

export const ICONS: Record<string, string> = {};
for (const [path, svg] of Object.entries(files)) ICONS[path.slice(path.lastIndexOf('/') + 1, -4)] = svg;

export type IconName = string;
