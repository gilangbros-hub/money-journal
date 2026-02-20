// Lightweight Confetti Animation Module
// Creates a canvas overlay with falling particles for celebration moments

function launchConfetti(duration = 2000) {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:99999;';
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');

    const particles = [];
    const colors = ['#000000', '#333333', '#666666', '#999999', '#CCCCCC', '#FFFFFF', '#444444'];
    const shapes = ['circle', 'rect', 'triangle'];

    // Create particles
    for (let i = 0; i < 80; i++) {
        particles.push({
            x: Math.random() * canvas.width,
            y: -20 - Math.random() * 100,
            vx: (Math.random() - 0.5) * 8,
            vy: Math.random() * 4 + 3,
            size: Math.random() * 8 + 4,
            color: colors[Math.floor(Math.random() * colors.length)],
            shape: shapes[Math.floor(Math.random() * shapes.length)],
            rotation: Math.random() * 360,
            rotSpeed: (Math.random() - 0.5) * 12,
            opacity: 1,
            gravity: 0.15
        });
    }

    const startTime = Date.now();

    function drawParticle(p) {
        ctx.save();
        ctx.globalAlpha = p.opacity;
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillStyle = p.color;

        if (p.shape === 'circle') {
            ctx.beginPath();
            ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
            ctx.fill();
        } else if (p.shape === 'rect') {
            ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        } else {
            ctx.beginPath();
            ctx.moveTo(0, -p.size / 2);
            ctx.lineTo(-p.size / 2, p.size / 2);
            ctx.lineTo(p.size / 2, p.size / 2);
            ctx.closePath();
            ctx.fill();
        }
        ctx.restore();
    }

    function animate() {
        const elapsed = Date.now() - startTime;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        particles.forEach(p => {
            p.x += p.vx;
            p.vy += p.gravity;
            p.y += p.vy;
            p.rotation += p.rotSpeed;
            p.vx *= 0.99;

            // Fade out near the end
            if (elapsed > duration * 0.6) {
                p.opacity = Math.max(0, 1 - (elapsed - duration * 0.6) / (duration * 0.4));
            }

            drawParticle(p);
        });

        if (elapsed < duration) {
            requestAnimationFrame(animate);
        } else {
            canvas.remove();
        }
    }

    requestAnimationFrame(animate);
}
