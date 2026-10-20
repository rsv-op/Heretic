package ai.heretic.app.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val Ember = Color(0xFFFF7A18)
private val EmberSoft = Color(0xFFFFA45C)
private val Mint = Color(0xFF2FE0A0)
private val Void = Color(0xFF06070A)
private val Panel = Color(0xFF0E1117)
private val Chalk = Color(0xFFE9ECF3)
private val Ash = Color(0xFF8691A4)
private val Rose = Color(0xFFFF4D6D)

private val HereticTypography = Typography()

private val DarkScheme = darkColorScheme(
    primary = Ember,
    onPrimary = Void,
    secondary = Mint,
    tertiary = EmberSoft,
    background = Void,
    surface = Panel,
    onSurface = Chalk,
    onSurfaceVariant = Ash,
    error = Rose,
)

private val LightScheme = lightColorScheme(
    primary = Color(0xFFB8470A),
    secondary = Color(0xFF0F7A57),
    background = Color(0xFFF6F4F1),
    surface = Color(0xFFFFFFFF),
)

@Composable
fun HereticTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkScheme else LightScheme,
        typography = HereticTypography,
        content = content,
    )
}
