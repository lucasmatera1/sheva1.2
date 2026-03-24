type LeagueUiConfig = {
  href: string;
  title: string;
  shortCode: string;
  glowClassName: string;
  buttonClassName: string;
  badgeClassName: string;
  dashboardTabClassName: string;
  dashboardTabMutedClassName: string;
  dashboardTabRingClassName: string;
  note: string;
  summary: string;
};

const LEAGUE_UI: Record<string, LeagueUiConfig> = {
  "GT LEAGUE": {
    href: "/leagues/gt-league",
    title: "GT League",
    shortCode: "GT",
    glowClassName: "bg-[radial-gradient(circle_at_top,_rgba(122,146,79,0.24),_transparent_68%)]",
    buttonClassName: "bg-[#20352e] text-white",
    badgeClassName: "bg-[#20352e] text-white",
    dashboardTabClassName: "bg-[linear-gradient(135deg,#1d332b_0%,#2f4d3f_100%)] text-white",
    dashboardTabMutedClassName: "border-[#9fb48a] bg-[#eef4e6] text-[#1f342d] hover:bg-[#e6efda]",
    dashboardTabRingClassName: "ring-[#cdddbd]",
    note: "Serie A e Serie B no detalhe",
    summary: "Liga com grupos internos e leitura separada por serie.",
  },
  "8MIN BATTLE": {
    href: "/leagues/8min-battle",
    title: "8Min Battle",
    shortCode: "8M",
    glowClassName: "bg-[radial-gradient(circle_at_top,_rgba(180,124,44,0.20),_transparent_68%)]",
    buttonClassName: "bg-[#7a4d1f] text-white",
    badgeClassName: "bg-[#7a4d1f] text-white",
    dashboardTabClassName: "bg-[linear-gradient(135deg,#7a4d1f_0%,#a56a2d_100%)] text-white",
    dashboardTabMutedClassName: "border-[#d7b07a] bg-[#fbf1e3] text-[#6a431b] hover:bg-[#f6e7d1]",
    dashboardTabRingClassName: "ring-[#ecd4af]",
    note: "Volume alto e ritmo estavel",
    summary: "Perfil de alta amostra para leitura rapida de tendencia.",
  },
  H2H: {
    href: "/leagues/h2h",
    title: "H2H",
    shortCode: "H2",
    glowClassName: "bg-[radial-gradient(circle_at_top,_rgba(40,96,126,0.20),_transparent_68%)]",
    buttonClassName: "bg-[#24516a] text-white",
    badgeClassName: "bg-[#24516a] text-white",
    dashboardTabClassName: "bg-[linear-gradient(135deg,#214d66_0%,#35789d_100%)] text-white",
    dashboardTabMutedClassName: "border-[#94b8cb] bg-[#eaf4f8] text-[#214d66] hover:bg-[#deedf4]",
    dashboardTabRingClassName: "ring-[#c7deea]",
    note: "Confronto direto entre jogadores",
    summary: "Leitura de duelo puro com menos ruido de formato.",
  },
  "6MIN VOLTA": {
    href: "/leagues/6min-volta",
    title: "6Min Volta",
    shortCode: "V6",
    glowClassName: "bg-[radial-gradient(circle_at_top,_rgba(126,52,52,0.20),_transparent_68%)]",
    buttonClassName: "bg-[#7a3f34] text-white",
    badgeClassName: "bg-[#7a3f34] text-white",
    dashboardTabClassName: "bg-[linear-gradient(135deg,#7a3f34_0%,#a55748_100%)] text-white",
    dashboardTabMutedClassName: "border-[#d3a093] bg-[#f9ece8] text-[#6e372d] hover:bg-[#f3dfd9]",
    dashboardTabRingClassName: "ring-[#e7c0b6]",
    note: "Ambiente mais ofensivo da base",
    summary: "Liga com tendencia forte para gols e BTTS altos.",
  },
};

function getLeagueUi(leagueType: string): LeagueUiConfig {
  return (
    LEAGUE_UI[leagueType] ?? {
      href: "/leagues",
      title: leagueType,
      shortCode: leagueType.slice(0, 2).toUpperCase(),
      glowClassName: "bg-[radial-gradient(circle_at_top,_rgba(122,146,79,0.18),_transparent_68%)]",
      buttonClassName: "bg-[#20352e] text-white",
      badgeClassName: "bg-[#20352e] text-white",
      dashboardTabClassName: "bg-[linear-gradient(135deg,#1d332b_0%,#2f4d3f_100%)] text-white",
      dashboardTabMutedClassName: "border-[#9fb48a] bg-[#eef4e6] text-[#1f342d] hover:bg-[#e6efda]",
      dashboardTabRingClassName: "ring-[#cdddbd]",
      note: "Abrir leitura detalhada da liga",
      summary: "Resumo consolidado da competicao.",
    }
  );
}

export { getLeagueUi };