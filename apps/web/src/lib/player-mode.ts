export type PlayerModeSlug = "gtleague" | "8min" | "h2h";

export type PlayerModeConfig = {
  slug: PlayerModeSlug;
  title: string;
  shortCode: string;
  leagueType: "GT LEAGUE" | "8MIN BATTLE" | "H2H";
  href: string;
  description: string;
  note: string;
  glowClassName: string;
  badgeClassName: string;
  buttonClassName: string;
};

const PLAYER_MODES: PlayerModeConfig[] = [
  {
    slug: "gtleague",
    title: "GT League",
    shortCode: "GT",
    leagueType: "GT LEAGUE",
    href: "/jogador/gtleague",
    description: "Modo focado no ecossistema GT League, com leitura isolada dos jogos do jogador dentro da liga.",
    note: "Ideal para leitura de volume, forma e confrontos recorrentes do GT.",
    glowClassName: "bg-[radial-gradient(circle_at_top,_rgba(122,146,79,0.24),_transparent_68%)]",
    badgeClassName: "bg-[#20352e] text-white",
    buttonClassName: "bg-[#20352e] text-white",
  },
  {
    slug: "8min",
    title: "8Min Battle",
    shortCode: "8M",
    leagueType: "8MIN BATTLE",
    href: "/jogador/8min",
    description: "Modo dedicado ao 8Min Battle para analisar apenas jogadores e partidas desse ambiente.",
    note: "Leitura mais direta para amostras altas e ritmo estavel de jogo.",
    glowClassName: "bg-[radial-gradient(circle_at_top,_rgba(180,124,44,0.20),_transparent_68%)]",
    badgeClassName: "bg-[#7a4d1f] text-white",
    buttonClassName: "bg-[#7a4d1f] text-white",
  },
  {
    slug: "h2h",
    title: "H2H",
    shortCode: "H2",
    leagueType: "H2H",
    href: "/jogador/h2h",
    description: "Modo de confronto direto entre jogadores, sem misturar os dados das outras ligas.",
    note: "Bom para enxergar padroes de duelo e historico recente entre players.",
    glowClassName: "bg-[radial-gradient(circle_at_top,_rgba(40,96,126,0.20),_transparent_68%)]",
    badgeClassName: "bg-[#24516a] text-white",
    buttonClassName: "bg-[#24516a] text-white",
  },
];

function getPlayerModeBySlug(value: string) {
  return PLAYER_MODES.find((mode) => mode.slug === value) ?? null;
}

export { PLAYER_MODES, getPlayerModeBySlug };