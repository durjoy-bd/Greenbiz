import { useState } from 'react';
import { useStore, StaleShopError } from '../data/store';
import { errorText } from '../utils';
export function useTask() {
  const [busy, setBusy] = useState(false);
  const { setError, taskIdentity } = useStore();
  async function run(fn: () => Promise<void>) {
    if (busy) return false;
    setBusy(true);
    setError('');
    let epoch = taskIdentity();
    try {
      const result = fn();
      epoch = taskIdentity();
      await result;
      return epoch === taskIdentity();
    } catch (e) {
      if (epoch === taskIdentity() && !(e instanceof StaleShopError)) setError(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, run };
}
