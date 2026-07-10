export type StatusBarDropdownState = {
  feedDropdownOpen: boolean;
  handledAtcToggle: number | undefined;
};

export function resolveDropdownState(
  state: StatusBarDropdownState,
  atcToggle?: number,
): Pick<StatusBarDropdownState, "feedDropdownOpen"> {
  if (atcToggle === undefined) {
    return {
      feedDropdownOpen: state.feedDropdownOpen,
    };
  }

  // Treat an undefined handledAtcToggle as a baseline one step behind
  // the incoming value so the first increment correctly toggles.
  const baseline = state.handledAtcToggle ?? atcToggle - 1;
  if (atcToggle <= baseline) {
    return {
      feedDropdownOpen: state.feedDropdownOpen,
    };
  }

  const toggleDelta = atcToggle - baseline;

  return {
    feedDropdownOpen:
      toggleDelta % 2 === 0 ? state.feedDropdownOpen : !state.feedDropdownOpen,
  };
}
