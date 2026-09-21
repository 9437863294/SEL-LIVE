using Sel.Agent.Core.Session;
using Xunit;

namespace Sel.Agent.Tests
{
    /// <summary>
    /// What the enforcing access gate swallows, and — more importantly — what it must not.
    /// </summary>
    /// <remarks>
    /// This decides whether a mandatory sign-in can be walked past, and whether somebody can
    /// get out of one that has gone wrong. Both failure directions are silent in the hook
    /// itself, so they are pinned here instead.
    /// </remarks>
    public class GateKeyPolicyTests
    {
        private const int A = 0x41;
        private const int Digit1 = 0x31;
        private const int Enter = 0x0D;
        private const int Backspace = 0x08;

        /* ── Must be swallowed, or the gate is decorative ─────────────────────────────── */

        [Theory]
        [InlineData(GateKeyPolicy.VK_LWIN)]
        [InlineData(GateKeyPolicy.VK_RWIN)]
        public void Both_windows_keys_are_always_swallowed(int key)
        {
            // Unmodified and in every chord: Win alone opens Start, Win+D shows the desktop,
            // Win+R opens Run. There is no Win shortcut worth letting through here.
            Assert.True(GateKeyPolicy.ShouldSwallow(key, false, false, false));
            Assert.True(GateKeyPolicy.ShouldSwallow(key, true, false, false));
            Assert.True(GateKeyPolicy.ShouldSwallow(key, false, true, false));
            Assert.True(GateKeyPolicy.ShouldSwallow(key, false, false, true));
        }

        [Fact]
        public void Alt_tab_is_swallowed()
        {
            Assert.True(GateKeyPolicy.ShouldSwallow(GateKeyPolicy.VK_TAB, true, false, false));
        }

        [Fact]
        public void Ctrl_escape_and_alt_escape_are_swallowed()
        {
            Assert.True(GateKeyPolicy.ShouldSwallow(GateKeyPolicy.VK_ESCAPE, false, true, false));
            Assert.True(GateKeyPolicy.ShouldSwallow(GateKeyPolicy.VK_ESCAPE, true, false, false));
        }

        [Fact]
        public void Ctrl_shift_escape_is_swallowed()
        {
            // Task Manager's direct shortcut. Ctrl+Alt+Delete still reaches it, because that
            // one is routed in the kernel and no application can intercept it.
            Assert.True(GateKeyPolicy.ShouldSwallow(GateKeyPolicy.VK_ESCAPE, false, true, true));
        }

        [Fact]
        public void Alt_f4_is_swallowed()
        {
            Assert.True(GateKeyPolicy.ShouldSwallow(GateKeyPolicy.VK_F4, true, false, false));
        }

        /* ── Must NOT be swallowed, or somebody is stuck ──────────────────────────────── */

        [Fact]
        public void Tab_on_its_own_still_moves_between_the_fields()
        {
            // The gate is an email box and a password box. Swallowing plain Tab would make it
            // unusable by anybody who does not reach for the mouse.
            Assert.False(GateKeyPolicy.ShouldSwallow(GateKeyPolicy.VK_TAB, false, false, false));
            Assert.False(GateKeyPolicy.ShouldSwallow(GateKeyPolicy.VK_TAB, false, false, true));
        }

        [Fact]
        public void The_emergency_release_still_reaches_the_gate()
        {
            // Ctrl+Shift+Alt+F12 is the documented way out of a gate that has gone wrong.
            // Swallowing it here would remove the only escape that does not need Task Manager.
            Assert.False(GateKeyPolicy.ShouldSwallow(GateKeyPolicy.VK_F12, true, true, true));
        }

        [Fact]
        public void Escape_alone_belongs_to_the_gate()
        {
            Assert.False(GateKeyPolicy.ShouldSwallow(GateKeyPolicy.VK_ESCAPE, false, false, false));
        }

        [Fact]
        public void F4_without_alt_is_an_ordinary_key()
        {
            Assert.False(GateKeyPolicy.ShouldSwallow(GateKeyPolicy.VK_F4, false, false, false));
        }

        [Theory]
        [InlineData(A)]
        [InlineData(Digit1)]
        [InlineData(Enter)]
        [InlineData(Backspace)]
        public void Ordinary_typing_passes_through(int key)
        {
            // An email address and a password have to be typeable, including with Shift held
            // for capitals and with Ctrl held by somebody pasting.
            Assert.False(GateKeyPolicy.ShouldSwallow(key, false, false, false));
            Assert.False(GateKeyPolicy.ShouldSwallow(key, false, false, true));
            Assert.False(GateKeyPolicy.ShouldSwallow(key, false, true, false));
        }

        [Fact]
        public void Ctrl_v_still_pastes()
        {
            const int V = 0x56;
            Assert.False(GateKeyPolicy.ShouldSwallow(V, false, true, false));
        }
    }
}
