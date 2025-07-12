// Get references to HTML elements
        const webcamVideo = document.getElementById('webcamVideo');
        const poseCanvas = document.getElementById('poseCanvas');
        const pushupCountDisplay = document.getElementById('pushupCount');
        const startButton = document.getElementById('startButton');
        const stopButton = document.getElementById('stopButton');
        const messageBox = document.getElementById('messageBox');
        const loadingSpinner = document.getElementById('loadingSpinner');

        // Get 2D rendering context for the canvas
        const canvasCtx = poseCanvas.getContext('2d');

        // Global variables for tracking
        let pose; // MediaPipe Pose object
        let camera; // MediaPipe Camera object
        let isTracking = false; // Flag to control tracking state
        let pushupCount = 0;
        let isDown = false; // State for push-up detection (true if in 'down' position)
        let videoStream = null; // To hold the webcam stream

        // Configuration for MediaPipe Pose
        const poseConfig = {
            locateFile: (file) => {
                return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
            }
        };

        // Initialize MediaPipe Pose
        // The `onResults` callback function will be called every time pose detection results are available.
        pose = new Pose(poseConfig);

        // Set up the pose detection model options
        pose.setOptions({
            modelComplexity: 1, // 0 (light), 1 (full), 2 (heavy) - 1 is a good balance
            smoothLandmarks: true, // Smooths out landmark movements
            enableSegmentation: false, // We don't need segmentation for push-ups
            smoothSegmentation: false,
            minDetectionConfidence: 0.5, // Minimum confidence for a pose to be detected
            minTrackingConfidence: 0.5 // Minimum confidence for tracking a pose
        });

        // Callback function when pose detection results are available
        pose.onResults(onResults);

        /**
         * Handles the results from the pose detection.
         * This function is called continuously when tracking is active.
         * @param {Object} results - The pose detection results containing landmarks.
         */
        function onResults(results) {
            // Only process results if tracking is active
            if (!isTracking) return;

            // Clear the canvas for drawing new frames
            canvasCtx.save();
            canvasCtx.clearRect(0, 0, poseCanvas.width, poseCanvas.height);

            // Draw the video frame on the canvas (mirrored)
            canvasCtx.drawImage(results.image, 0, 0, poseCanvas.width, poseCanvas.height);

            // If pose landmarks are detected, draw them and count push-ups
            if (results.poseLandmarks) {
                // Draw the connections between landmarks (e.g., bones)
                drawConnectors(canvasCtx, results.poseLandmarks, POSE_CONNECTIONS,
                               {color: '#00FF00', lineWidth: 4}); // Green lines

                // Draw the landmarks themselves
                drawLandmarks(canvasCtx, results.poseLandmarks,
                              {color: '#FF0000', lineWidth: 2}); // Red dots

                // Perform push-up counting logic
                countPushups(results.poseLandmarks);
            }
            canvasCtx.restore();
        }

        /**
         * Counts push-ups based on the detected pose landmarks.
         * This is the core logic for push-up detection.
         * @param {Array<Object>} landmarks - An array of pose landmark objects.
         */
        function countPushups(landmarks) {
            // Get relevant landmark positions (using normalized coordinates)
            // Landmark indices:
            // 11: left shoulder, 12: right shoulder
            // 13: left elbow, 14: right elbow
            // 15: left wrist, 16: right wrist
            // 23: left hip, 24: right hip

            const leftShoulder = landmarks[POSE_LANDMARKS.LEFT_SHOULDER];
            const rightShoulder = landmarks[POSE_LANDMARKS.RIGHT_SHOULDER];
            const leftElbow = landmarks[POSE_LANDMARKS.LEFT_ELBOW];
            const rightElbow = landmarks[POSE_LANDMARKS.RIGHT_ELBOW];
            const leftWrist = landmarks[POSE_LANDMARKS.LEFT_WRIST];
            const rightWrist = landmarks[POSE_LANDMARKS.RIGHT_WRIST];
            const leftHip = landmarks[POSE_LANDMARKS.LEFT_HIP];
            const rightHip = landmarks[POSE_LANDMARKS.RIGHT_HIP];

            // Ensure all required landmarks are detected with sufficient visibility
            const minVisibility = 0.7; // Confidence threshold for landmark visibility
            if (!leftShoulder || leftShoulder.visibility < minVisibility ||
                !rightShoulder || rightShoulder.visibility < minVisibility ||
                !leftElbow || leftElbow.visibility < minVisibility ||
                !rightElbow || rightElbow.visibility < minVisibility ||
                !leftWrist || leftWrist.visibility < minVisibility ||
                !rightWrist || rightWrist.visibility < minVisibility ||
                !leftHip || leftHip.visibility < minVisibility ||
                !rightHip || rightHip.visibility < minVisibility) {
                // Not enough visible landmarks to reliably count
                return;
            }

            // Calculate angles for push-up detection
            // We'll use the angle between shoulder, elbow, and wrist to determine arm bend.
            // A smaller angle means the arm is more bent (down position).

            // Helper function to calculate angle between three points (A, B, C) with B as the vertex
            function calculateAngle(A, B, C) {
                const AB = Math.sqrt(Math.pow(B.x - A.x, 2) + Math.pow(B.y - A.y, 2));
                const BC = Math.sqrt(Math.pow(C.x - B.x, 2) + Math.pow(C.y - B.y, 2));
                const AC = Math.sqrt(Math.pow(C.x - A.x, 2) + Math.pow(A.y - C.y, 2)); // Corrected for y-axis difference

                // Use Law of Cosines to find the angle at B
                // cos(B) = (AB^2 + BC^2 - AC^2) / (2 * AB * BC)
                const angleRad = Math.acos((AB * AB + BC * BC - AC * AC) / (2 * AB * BC));
                return angleRad * 180 / Math.PI; // Convert to degrees
            }

            const leftElbowAngle = calculateAngle(leftShoulder, leftElbow, leftWrist);
            const rightElbowAngle = calculateAngle(rightShoulder, rightElbow, rightWrist);

            // Average the elbow angles for robustness
            const avgElbowAngle = (leftElbowAngle + rightElbowAngle) / 2;

            // Also consider the vertical position of the shoulders relative to hips/wrists
            // When going down, shoulders move closer to the ground (larger y-value in normalized coords)
            const avgShoulderY = (leftShoulder.y + rightShoulder.y) / 2;
            const avgHipY = (leftHip.y + rightHip.y) / 2;
            const avgWristY = (leftWrist.y + rightWrist.y) / 2;

            // Thresholds for push-up detection
            const DOWN_ANGLE_THRESHOLD = 90; // Angle when arms are significantly bent (e.g., 90 degrees or less)
            const UP_ANGLE_THRESHOLD = 160; // Angle when arms are mostly straight (e.g., 160 degrees or more)

            // Additional check: Shoulders should be below hips in the down phase
            // (y-coordinates increase downwards in normalized coordinates)
            const SHOULDER_HIP_THRESHOLD = 0.05; // Shoulders should be significantly below hips
            const isShoulderBelowHip = (avgShoulderY - avgHipY) > SHOULDER_HIP_THRESHOLD;

            // State machine for counting push-ups
            if (avgElbowAngle < DOWN_ANGLE_THRESHOLD && isShoulderBelowHip) {
                // User is in the 'down' position
                isDown = true;
            } else if (avgElbowAngle > UP_ANGLE_THRESHOLD && isDown) {
                // User is in the 'up' position after being 'down'
                pushupCount++;
                pushupCountDisplay.textContent = pushupCount;
                isDown = false; // Reset for the next push-up
            }
        }

        /**
         * Starts the webcam and begins pose tracking.
         */
        async function startTracking() {
            try {
                // Show loading spinner
                loadingSpinner.style.display = 'block';
                messageBox.style.display = 'none'; // Hide any previous messages

                // If there's an existing stream, stop its tracks first to release the camera
                if (videoStream) {
                    videoStream.getTracks().forEach(track => track.stop());
                    webcamVideo.srcObject = null;
                    videoStream = null;
                }

                // Request access to the user's webcam
                videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
                webcamVideo.srcObject = videoStream;

                // Wait for the video to load metadata to get its dimensions
                await new Promise((resolve) => {
                    webcamVideo.onloadedmetadata = () => {
                        // Set canvas dimensions to match video dimensions
                        poseCanvas.width = webcamVideo.videoWidth;
                        poseCanvas.height = webcamVideo.videoHeight;
                        resolve();
                    };
                });

                // Initialize MediaPipe Camera utility
                // This sends video frames to the pose detection model.
                camera = new Camera(webcamVideo, {
                    onFrame: async () => {
                        // Send the video frame to the pose model for processing
                        if (isTracking) { // Only send frames if tracking is active
                            await pose.send({image: webcamVideo});
                        }
                    },
                    width: webcamVideo.videoWidth,
                    height: webcamVideo.videoHeight
                });

                // Start the camera stream
                await camera.start();

                // Set tracking state to true
                isTracking = true;
                pushupCount = 0; // Reset count on start
                pushupCountDisplay.textContent = pushupCount;
                isDown = false; // Reset push-up state

                // Update button states
                startButton.disabled = true;
                stopButton.disabled = false;

                // Hide loading spinner and show success message
                loadingSpinner.style.display = 'none';
                showMessage('Webcam and tracking started!', 'success');

            } catch (error) {
                console.error('Error accessing webcam or starting tracking:', error);
                loadingSpinner.style.display = 'none';
                // Check if the error is due to the device being in use
                if (error.name === 'NotReadableError' || error.name === 'OverconstrainedError') {
                    showMessage('Error: Webcam is in use by another application. Please close other apps and try again.', 'error');
                } else {
                    showMessage('Error: Could not access webcam. Please ensure it\'s connected and permissions are granted.', 'error');
                }
                // Disable start button if webcam access fails
                startButton.disabled = false;
                stopButton.disabled = true;
            }
        }

        /**
         * Stops the webcam and pose tracking.
         */
        function stopTracking() {
            isTracking = false; // Stop processing frames

            // Stop the camera utility
            if (camera) {
                camera.stop();
            }

            // Stop the webcam video stream
            if (videoStream) {
                videoStream.getTracks().forEach(track => track.stop());
                webcamVideo.srcObject = null;
                videoStream = null; // Clear the stream reference
            }

            // Clear the canvas
            canvasCtx.clearRect(0, 0, poseCanvas.width, poseCanvas.height);

            // Update button states
            startButton.disabled = false;
            stopButton.disabled = true;

            showMessage('Tracking stopped. Push-ups counted: ' + pushupCount, 'success');
        }

        /**
         * Displays a message in the message box.
         * @param {string} message - The message to display.
         * @param {string} type - 'success' or 'error' to determine styling.
         */
        function showMessage(message, type) {
            messageBox.textContent = message;
            messageBox.className = `message-box ${type}`; // Apply type class
            messageBox.style.display = 'block';
            // Hide message after a few seconds
            setTimeout(() => {
                messageBox.style.display = 'none';
            }, 5000);
        }

        // Event listeners for buttons
        startButton.addEventListener('click', startTracking);
        stopButton.addEventListener('click', stopTracking);

        // Initial message to the user
        showMessage('Click "Start Tracking" to begin your push-up workout!', 'success');

        // Handle window resize to ensure canvas remains responsive
        window.addEventListener('resize', () => {
            // Re-set canvas dimensions if video is active
            if (webcamVideo.srcObject) {
                poseCanvas.width = webcamVideo.videoWidth;
                poseCanvas.height = webcamVideo.videoHeight;
            }
        });
