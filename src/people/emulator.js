    // ===== HUMAN EMULATION =====
    // Simulates human browsing behavior (scrolling, mouse movement, pauses)
    // to avoid triggering LinkedIn's bot detection.
    const Emulator = {
        /** Flag to allow cancellation of the emulation sequence */
        cancelled: false,

        /**
         * Generate a random integer between min and max (inclusive).
         * @param {number} min - Minimum value.
         * @param {number} max - Maximum value.
         * @returns {number} Random integer in [min, max].
         */
        getRandomInt: function(min, max) {
            return Math.floor(Math.random() * (max - min + 1)) + min;
        },

        /**
         * Return a Promise that resolves after a random delay.
         * @param {number} minMs - Minimum milliseconds.
         * @param {number} maxMs - Maximum milliseconds.
         * @returns {Promise<void>}
         */
        randomDelay: function(minMs, maxMs) {
            const delay = this.getRandomInt(minMs, maxMs);
            return new Promise(function(resolve) {
                setTimeout(resolve, delay);
            });
        },

        /**
         * Dispatch a synthetic mousemove event at randomized coordinates.
         * @param {number} approximateY - Approximate vertical position to center the movement around.
         */
        dispatchMouseMove: function(approximateY) {
            const eventInit = {
                bubbles: true,
                cancelable: true,
                clientX: this.getRandomInt(200, 800),
                clientY: approximateY + this.getRandomInt(-30, 30),
                screenX: this.getRandomInt(200, 800),
                screenY: approximateY + this.getRandomInt(-30, 30)
            };
            const event = new MouseEvent('mousemove', eventInit);

            document.dispatchEvent(event);

            if (document.body) {
                document.body.dispatchEvent(new MouseEvent('mousemove', eventInit));
            }
            const mainEl = document.querySelector('main') || document.querySelector('[role="main"]');
            if (mainEl) {
                mainEl.dispatchEvent(new MouseEvent('mousemove', eventInit));
            }
        },

        /**
         * Dispatch a synthetic scroll event on all relevant scroll containers.
         */
        dispatchScrollEvent: function() {
            window.dispatchEvent(new Event('scroll', { bubbles: true }));
            document.dispatchEvent(new Event('scroll', { bubbles: true }));

            const scrollTargets = [
                document.querySelector('main'),
                document.querySelector('[role="main"]'),
                document.querySelector('[role="list"]')
            ];
            scrollTargets.forEach(function(target) {
                if (target) {
                    target.dispatchEvent(new Event('scroll', { bubbles: true }));
                }
            });
        },

        /**
         * Run the full human emulation sequence for page scanning.
         * @param {string} statusPrefix - Text to show before the countdown.
         * @returns {Promise<void>} Resolves when emulation is complete.
         */
        emulateHumanScan: function(statusPrefix) {
            this.cancelled = false;
            const self = this;

            const totalTimeMs = this.getRandomInt(
                CONFIG.MIN_PAGE_TIME * 1000,
                CONFIG.MAX_PAGE_TIME * 1000
            );
            const totalTimeSec = Math.round(totalTimeMs / 1000);

            const pageHeight = document.documentElement.scrollHeight;
            const viewportHeight = window.innerHeight;
            const scrollableDistance = Math.max(pageHeight - viewportHeight, 0);

            const averageStepMs = 450;
            const numberOfSteps = Math.max(Math.floor(totalTimeMs / averageStepMs), 10);
            const baseScrollPerStep = scrollableDistance / numberOfSteps;

            const numberOfPauses = self.getRandomInt(2, 3);
            const pauseSteps = new Set();
            while (pauseSteps.size < numberOfPauses) {
                pauseSteps.add(self.getRandomInt(2, numberOfSteps - 2));
            }

            console.log('[LiSeSca] Emulation: ' + numberOfSteps + ' steps over ~'
                + totalTimeSec + 's, '
                + numberOfPauses + ' reading pauses.');

            const startTimeMs = Date.now();
            const prefix = statusPrefix || 'Scanning';
            UI.showStatus(prefix + ' — ' + totalTimeSec + 's remaining');

            let currentScroll = 0;

            /**
             * Execute one scroll step, then schedule the next.
             * @param {number} step - Current step index (0-based).
             * @returns {Promise<void>}
             */
            function executeStep(step) {
                if (self.cancelled) {
                    console.log('[LiSeSca] Emulation cancelled.');
                    return Promise.resolve();
                }
                if (step >= numberOfSteps) {
                    window.scrollTo({ top: scrollableDistance, behavior: 'smooth' });
                    self.dispatchScrollEvent();
                    return Promise.resolve();
                }

                const elapsedMs = Date.now() - startTimeMs;
                const remainingSec = Math.max(0, Math.round((totalTimeMs - elapsedMs) / 1000));
                UI.showStatus(prefix + ' — ' + remainingSec + 's remaining');

                const scrollAmount = baseScrollPerStep * (0.6 + Math.random() * 0.8);
                currentScroll = Math.min(currentScroll + scrollAmount, scrollableDistance);
                window.scrollTo({ top: currentScroll, behavior: 'smooth' });

                self.dispatchScrollEvent();

                const mouseY = self.getRandomInt(100, viewportHeight - 100);
                self.dispatchMouseMove(mouseY);

                let delayMin = 200;
                let delayMax = 600;

                if (pauseSteps.has(step)) {
                    delayMin = 1000;
                    delayMax = 3000;
                }

                return self.randomDelay(delayMin, delayMax).then(function() {
                    return executeStep(step + 1);
                });
            }

            return executeStep(0).then(function() {
                console.log('[LiSeSca] Emulation complete.');
            });
        },

        /**
         * Cancel the ongoing emulation sequence.
         */
        cancel: function() {
            this.cancelled = true;
        }
    };


