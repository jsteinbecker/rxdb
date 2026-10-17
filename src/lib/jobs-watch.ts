/** Wakes the job overlay to poll quickly — call when starting a long server operation. */
export function watchJobs() {
	if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('jobs:watch'));
}
