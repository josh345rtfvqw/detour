// Built-in list of known Floatplane creators, used when Floatplane's own creator list can't
// be loaded (e.g. not logged in). When it can, the live list is used and these fill any gaps.
//
// Entries with an `id` and `urlname` have confirmed details (from the community Floatplane
// API spec, github.com/Jman012/FloatplaneAPI). The rest come from Floatplane's Browse
// Creators page (November 2026) and are matched to YouTube by channel name; their Floatplane
// address isn't known, so links go to Floatplane's home page until the live list provides it.

// Key used to remember a subscription to a creator whose Floatplane ID isn't known.
const fpNameKey = title => 'name:' + String(title || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const FLOATPLANE_DEFAULTS = [
  {
    id: '59f94c0bdd241b70349eb72b', title: 'LinusTechTips', urlname: 'linustechtips',
    links: ['https://www.youtube.com/user/LinusTechTips'],
    channels: [
      { id: '63fe42c309e691e4e36de93d', title: 'Linus Tech Tips', urlname: 'main', links: ['https://www.youtube.com/@LinusTechTips'] },
      { id: '6413534d88c13c181c3e2809', title: 'TechLinked', urlname: 'techlinked', links: ['https://www.youtube.com/@TechLinked'] },
      { id: '64135e27c773b27ff22c97eb', title: 'Techquickie', urlname: 'techquickie', links: ['https://www.youtube.com/@Techquickie'] },
      { id: '64135da7ce81077a8480c679', title: 'ShortCircuit', urlname: 'shortcircuit', links: ['https://www.youtube.com/@ShortCircuit'] },
      { id: '64135e901ebaee42e258eb0b', title: 'Mac Address', urlname: 'macaddress', links: ['https://www.youtube.com/@macaddress'] },
      { id: '64135ed078d6262f717341b7', title: 'Channel Super Fun', urlname: 'channelsuperfun', links: ['https://www.youtube.com/@ChannelSuperFun'] },
      { id: '64135f82fc76ab7f9fbdc876', title: 'They\'re Just Movies', urlname: 'tajm', links: [] },
    ],
  },
  { id: '5d2fd26df33b8d14fc5ff48d', title: 'EposVox', urlname: 'eposvox', links: ['https://www.youtube.com/eposvox'] },
  ...[
    'Level1Techs', '3D Printing Nerd', 'The Mighty Jingles', 'Tyler McVicker', 'Robert Neal',
    'Lawful Masses with Leonard French', 'Forgotten Weapons', 'Lon.TV', 'Craft Computing',
    'The Gun Collective', 'Ivycomb', 'The Trash Network', 'Shank Mods', 'DMS', 'James Channel',
    'Jeff Geerling', 'Hardware Haven', 'Bringus Studios',
  ].map(title => ({ id: fpNameKey(title), title, urlname: null, links: [] })),
].map(c => ({ icon: '', channels: [], builtin: true, ...c }));

if (typeof module !== 'undefined') module.exports = { FLOATPLANE_DEFAULTS, fpNameKey };
