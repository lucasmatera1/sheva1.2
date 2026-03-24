export type DisparityModeSlug = "GT" | "Volta" | "Basket";

type DisparityModeConfig = {
  slug: DisparityModeSlug;
  title: string;
  leagueTypeLabel: string;
  href: string;
  gamesPerOpponent: number;
  gamesPerDay: number;
  description: string;
  badgeClassName: string;
  buttonClassName: string;
  glowClassName: string;
};

const DISPARITY_MODES: DisparityModeConfig[] = [
  {
    slug: "GT",
    title: "GT",
    leagueTypeLabel: "GT League",
    href: "/Disparidade/GT",
    gamesPerOpponent: 6,
    gamesPerDay: 24,
    description: "Cada confronto de campeonato entre jogadores acontece 6 vezes, com leitura orientada por id do campeonato.",
    badgeClassName: "bg-[#20352e] text-white",
    buttonClassName: "bg-[#20352e] text-white",
    glowClassName: "bg-[radial-gradient(circle_at_top,_rgba(122,146,79,0.24),_transparent_68%)]",
  },
  {
    slug: "Volta",
    title: "Volta",
    leagueTypeLabel: "6Min Volta",
    href: "/Disparidade/Volta",
    gamesPerOpponent: 8,
    gamesPerDay: 32,
    description: "No modo Volta, cada confronto ocorre 8 vezes, com 32 jogos por janela J e leitura separada em blocos J1, J2 e J3.",
    badgeClassName: "bg-[#7a3f34] text-white",
    buttonClassName: "bg-[#7a3f34] text-white",
    glowClassName: "bg-[radial-gradient(circle_at_top,_rgba(126,52,52,0.20),_transparent_68%)]",
  },
  {
    slug: "Basket",
    title: "Basket",
    leagueTypeLabel: "H2H Basket",
    href: "/Disparidade/Basket",
    gamesPerOpponent: 6,
    gamesPerDay: 24,
    description: "Leitura de disparidade para a base H2H Basket, com foco em media de vitorias por confronto e repeticao recente por adversario.",
    badgeClassName: "bg-[#214d66] text-white",
    buttonClassName: "bg-[#214d66] text-white",
    glowClassName: "bg-[radial-gradient(circle_at_top,_rgba(53,120,157,0.24),_transparent_68%)]",
  },
];

function getDisparityModeBySlug(value: string) {
  const normalizedValue = value.trim().toLowerCase();
  return DISPARITY_MODES.find((mode) => mode.slug.toLowerCase() === normalizedValue) ?? null;
}

export { DISPARITY_MODES, getDisparityModeBySlug };