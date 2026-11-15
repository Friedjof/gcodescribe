import { useEffect, useState } from "react";
import { PageNavigation } from "../lib/pageNavigation";

export function usePageNavigation(projectId: string | undefined, visible: boolean) {
  const [navigation] = useState(() => new PageNavigation());
  navigation.setScope(JSON.stringify([projectId, visible]));
  useEffect(() => {
    navigation.setEnabled(true);
    return () => navigation.setEnabled(false);
  }, [navigation]);
  return navigation;
}
