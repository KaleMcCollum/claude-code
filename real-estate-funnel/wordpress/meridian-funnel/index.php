<?php
/**
 * The one-page funnel. All text comes from the Customizer via meridian_get().
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
?><!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php bloginfo( 'charset' ); ?>">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>

<header class="site-header">
	<div class="wrap header-inner">
		<a class="logo" href="<?php echo esc_url( home_url( '/' ) ); ?>"><?php echo esc_html( meridian_get( 'brand_first' ) ); ?><span>&nbsp;<?php echo esc_html( meridian_get( 'brand_second' ) ); ?></span></a>
		<a class="header-phone" href="tel:<?php echo esc_attr( meridian_get( 'phone_tel' ) ); ?>"><b>Direct:</b> <?php echo esc_html( meridian_get( 'phone_display' ) ); ?></a>
	</div>
</header>

<div class="hero">
	<div class="wrap hero-grid">
		<div>
			<div class="eyebrow"><?php echo esc_html( meridian_get( 'eyebrow' ) ); ?></div>
			<h1 class="display"><?php echo esc_html( meridian_get( 'headline_main' ) ); ?> <span class="hl"><?php echo esc_html( meridian_get( 'headline_accent' ) ); ?></span></h1>
			<p class="hero-sub"><?php echo wp_kses_post( meridian_get( 'hero_sub' ) ); ?></p>
			<div class="hero-terms">
				<div><?php echo esc_html( meridian_get( 'term_1' ) ); ?></div>
				<div><?php echo esc_html( meridian_get( 'term_2' ) ); ?></div>
				<div><?php echo esc_html( meridian_get( 'term_3' ) ); ?></div>
			</div>
		</div>

		<div class="form-card" id="lead-form-card">
			<h2 id="form-title"><?php echo esc_html( meridian_get( 'form_title' ) ); ?></h2>
			<p class="form-sub" id="form-sub"><?php echo esc_html( meridian_get( 'form_sub' ) ); ?></p>
			<div class="step-label" id="step-label">Step 1 / 2 &mdash; The Property</div>

			<form id="lead-form" novalidate>
				<div class="step active" data-step="1">
					<div class="field">
						<label for="address">Property Address</label>
						<input type="text" id="address" name="address" placeholder="450 Commerce Blvd, Your City" autocomplete="street-address">
						<div class="err">Enter the property address.</div>
					</div>
					<div class="field">
						<label>Asset Type</label>
						<div class="pill-group" data-pills="asset">
							<button type="button" class="pill">Office</button>
							<button type="button" class="pill">Retail</button>
							<button type="button" class="pill">Industrial</button>
							<button type="button" class="pill">Multifamily</button>
							<button type="button" class="pill">Land</button>
							<button type="button" class="pill">Other</button>
						</div>
						<input type="hidden" name="asset" id="asset">
						<div class="err">Pick an asset type.</div>
					</div>
					<button type="button" class="btn" data-next>Value My Property &rarr;</button>
					<div class="micro">Strictly confidential. Never shared, never listed without your say-so.</div>
				</div>

				<div class="step" data-step="2">
					<!-- Honeypot: humans never see or fill this. -->
					<div class="hp-field" aria-hidden="true">
						<label for="company">Company</label>
						<input type="text" id="company" name="company" tabindex="-1" autocomplete="off">
					</div>
					<div class="field">
						<label for="name">Name</label>
						<input type="text" id="name" name="name" placeholder="Jordan Blake" autocomplete="name">
						<div class="err">Enter your name.</div>
					</div>
					<div class="field">
						<label for="email">Email</label>
						<input type="email" id="email" name="email" placeholder="jordan@company.com" autocomplete="email">
						<div class="err">Enter a valid email.</div>
					</div>
					<div class="field">
						<label for="phone">Direct Line</label>
						<input type="tel" id="phone" name="phone" placeholder="(555) 555-0123" autocomplete="tel">
						<div class="err">Enter a valid phone number.</div>
					</div>
					<button type="submit" class="btn" id="submit-btn">Send My Valuation</button>
					<button type="button" class="btn-back" data-back>&larr; Back</button>
					<div class="micro">One broker will contact you. No lists. No spam. Ever.</div>
				</div>
			</form>

			<div class="success" id="success">
				<div class="big-check">&#10003;</div>
				<h3><?php echo esc_html( meridian_get( 'success_title' ) ); ?></h3>
				<p><?php echo wp_kses_post( meridian_get( 'success_text' ) ); ?></p>
			</div>
		</div>
	</div>
</div>

<div class="stats">
	<div class="wrap stats-grid">
		<div class="stat"><div class="num"><?php echo esc_html( meridian_get( 'stat1_num' ) ); ?><span><?php echo esc_html( meridian_get( 'stat1_suffix' ) ); ?></span></div><div class="lbl"><?php echo esc_html( meridian_get( 'stat1_label' ) ); ?></div></div>
		<div class="stat"><div class="num"><?php echo esc_html( meridian_get( 'stat2_num' ) ); ?><span><?php echo esc_html( meridian_get( 'stat2_suffix' ) ); ?></span></div><div class="lbl"><?php echo esc_html( meridian_get( 'stat2_label' ) ); ?></div></div>
		<div class="stat"><div class="num"><?php echo esc_html( meridian_get( 'stat3_num' ) ); ?><span><?php echo esc_html( meridian_get( 'stat3_suffix' ) ); ?></span></div><div class="lbl"><?php echo esc_html( meridian_get( 'stat3_label' ) ); ?></div></div>
	</div>
</div>

<section class="statement">
	<div class="wrap">
		<h2 class="display"><?php echo esc_html( meridian_get( 'statement_main' ) ); ?> <span class="hl"><?php echo esc_html( meridian_get( 'statement_accent' ) ); ?></span></h2>
		<div class="punch-grid">
			<div class="punch">
				<h3><?php echo esc_html( meridian_get( 'punch1_title' ) ); ?></h3>
				<p><?php echo wp_kses_post( meridian_get( 'punch1_text' ) ); ?></p>
			</div>
			<div class="punch">
				<h3><?php echo esc_html( meridian_get( 'punch2_title' ) ); ?></h3>
				<p><?php echo wp_kses_post( meridian_get( 'punch2_text' ) ); ?></p>
			</div>
			<div class="punch">
				<h3><?php echo esc_html( meridian_get( 'punch3_title' ) ); ?></h3>
				<p><?php echo wp_kses_post( meridian_get( 'punch3_text' ) ); ?></p>
			</div>
		</div>
	</div>
</section>

<section class="quote">
	<div class="wrap">
		<blockquote>&ldquo;<?php echo esc_html( meridian_get( 'quote_pre' ) ); ?> <span class="hl"><?php echo esc_html( meridian_get( 'quote_accent' ) ); ?></span> <?php echo esc_html( meridian_get( 'quote_post' ) ); ?>&rdquo;</blockquote>
		<cite><?php echo esc_html( meridian_get( 'quote_cite' ) ); ?></cite>
	</div>
</section>

<section class="final">
	<div class="wrap">
		<h2 class="display"><?php echo esc_html( meridian_get( 'final_main' ) ); ?><br><span class="hl"><?php echo esc_html( meridian_get( 'final_accent' ) ); ?></span></h2>
		<p><?php echo esc_html( meridian_get( 'final_sub' ) ); ?></p>
		<button class="btn" data-scroll-form><?php echo esc_html( meridian_get( 'cta_label' ) ); ?> &rarr;</button>
	</div>
</section>

<footer class="site-footer">
	<div class="wrap">
		<div class="foot-row">
			<a class="logo" href="<?php echo esc_url( home_url( '/' ) ); ?>"><?php echo esc_html( meridian_get( 'brand_first' ) ); ?><span>&nbsp;<?php echo esc_html( meridian_get( 'brand_second' ) ); ?></span></a>
			<div><?php echo esc_html( meridian_get( 'phone_display' ) ); ?> &bull; <?php echo esc_html( meridian_get( 'contact_email' ) ); ?></div>
		</div>
		<p><?php echo esc_html( meridian_get( 'brand_first' ) . ' ' . meridian_get( 'brand_second' ) ); ?> &bull; <?php echo wp_kses_post( meridian_get( 'footer_legal' ) ); ?> &copy; <?php echo esc_html( gmdate( 'Y' ) ); ?></p>
	</div>
</footer>

<div class="sticky-cta" id="sticky-cta">
	<button class="btn" data-scroll-form><?php echo esc_html( meridian_get( 'cta_label' ) ); ?> &rarr;</button>
</div>

<?php wp_footer(); ?>
</body>
</html>
