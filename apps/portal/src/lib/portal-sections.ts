export type PortalSectionChildItem = {
  slug: string;
  label: string;
  path: string;
  iconLabel?: string;
  iconWide?: boolean;
};

export type PortalSectionItem = {
  slug: string;
  label: string;
  path: string;
  children?: PortalSectionChildItem[];
};

export type PortalSectionGroup = {
  key: "ebasketball" | "esoccer";
  label: string;
  items: PortalSectionItem[];
};

export const portalSectionGroups: PortalSectionGroup[] = [
  {
    key: "ebasketball",
    label: "E-basketball",
    items: [
      {
        slug: "h2h-gg-league",
        label: "H2H GG League",
        path: "/ebasketball/h2h-gg-league",
      },
      {
        slug: "battle-league",
        label: "Battle League",
        path: "/ebasketball/battle-league",
      },
    ],
  },
  {
    key: "esoccer",
    label: "E-Soccer",
    items: [
      {
        slug: "battle-volta-6min",
        label: "Battle Volta 6min",
        path: "/esoccer/battle-volta-6min",
      },
      {
        slug: "battle-8min",
        label: "Battle 8min",
        path: "/esoccer/battle-8min",
      },
      {
        slug: "eadriatic",
        label: "eAdriatic",
        path: "/esoccer/eadriatic",
      },
      {
        slug: "gt-league",
        label: "GT League",
        path: "/esoccer/gt-league",
        children: [
          {
            slug: "panorama",
            label: "Panorama",
            path: "/esoccer/gt-league/panorama",
          },
          {
            slug: "raio-x",
            label: "Raio X",
            path: "/esoccer/gt-league/raio-x",
            iconLabel: "RX",
            iconWide: true,
          },
          {
            slug: "disparidade",
            label: "Disparidade",
            path: "/esoccer/gt-league/disparidade",
          },
          {
            slug: "metodos",
            label: "Metodos",
            path: "/esoccer/gt-league/metodos",
          },
        ],
      },
      {
        slug: "h2h",
        label: "H2H",
        path: "/esoccer/h2h",
      },
    ],
  },
];

export function getPortalSection(groupKey: PortalSectionGroup["key"], slug: string) {
  const group = portalSectionGroups.find((entry) => entry.key === groupKey);

  if (!group) {
    return null;
  }

  const item = group.items.find((entry) => entry.slug === slug);

  if (!item) {
    return null;
  }

  return {
    group,
    item,
  };
}
