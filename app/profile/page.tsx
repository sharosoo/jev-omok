import { PlayerRecord } from "@/components/account/PlayerRecord";
import { UI } from "@/lib/lines";

export default function ProfilePage() {
  return (
    <main className="page">
      <h1 className="page__title">{UI.profile.title}</h1>
      <PlayerRecord />
    </main>
  );
}
