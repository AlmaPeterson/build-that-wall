// The app shell: shows the current screen and applies the text-size settings.
import type { FunctionComponent } from 'preact';
import { screen, settings, type Screen } from './app-state';
import { AccountScreen } from './screens/Account';
import { GameScreen } from './screens/Game';
import { InstructionsScreen } from './screens/Instructions';
import { LeaderboardScreen } from './screens/Leaderboard';
import { MenuScreen } from './screens/Menu';
import { OnlineScreen } from './screens/Online';
import { SettingsScreen } from './screens/Settings';
import { online } from './online';
import { StillHere } from './online/StillHere';
import { useStore } from './store';

const SCREENS: Record<Screen, FunctionComponent> = {
  menu: MenuScreen,
  settings: SettingsScreen,
  instructions: InstructionsScreen,
  game: GameScreen,
  account: AccountScreen,
  online: OnlineScreen,
  leaderboard: LeaderboardScreen,
};

export function App() {
  const current = useStore(screen);
  const { textSizes } = useStore(settings);
  const Current = SCREENS[current];
  const style = Object.fromEntries(Object.entries(textSizes).map(([k, v]) => ['--text-' + k, String(v)]));
  return <div class="app" style={style}><Current /><StillHere session={online} /></div>;
}
