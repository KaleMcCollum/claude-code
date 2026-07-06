<?php
/**
 * Meridian CRE Funnel theme.
 *
 * Everything editable lives in the Customizer (Appearance → Customize).
 * Form submissions are stored as "Leads" in wp-admin and emailed to the
 * address set under Customize → Lead Capture.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/* ---------------------------------------------------------------
 * Every editable field on the page: id => [section, label, default, type]
 * ------------------------------------------------------------- */
function meridian_fields() {
	return array(
		// Branding.
		'brand_first'     => array( 'branding', 'Firm name (white part)', 'Meridian', 'text' ),
		'brand_second'    => array( 'branding', 'Firm name (accent part)', 'CRE', 'text' ),
		'accent_color'    => array( 'branding', 'Accent color', '#ffb400', 'color' ),
		'phone_display'   => array( 'branding', 'Phone (as shown)', '(555) 555-0123', 'text' ),
		'phone_tel'       => array( 'branding', 'Phone (digits for tap-to-call, e.g. +15555550123)', '+15555550123', 'text' ),
		'contact_email'   => array( 'branding', 'Public contact email (footer)', 'deals@meridiancre.example', 'text' ),

		// Hero.
		'eyebrow'         => array( 'hero', 'Eyebrow line', 'Commercial Property Owners', 'text' ),
		'headline_main'   => array( 'hero', 'Headline (white part)', "Know your building's", 'text' ),
		'headline_accent' => array( 'hero', 'Headline (accent part)', 'real number.', 'text' ),
		'hero_sub'        => array( 'hero', 'Subheadline', "A confidential broker opinion of value from principals who've closed $1.2B in commercial deals. In your inbox within 48 hours.", 'textarea' ),
		'term_1'          => array( 'hero', 'Term 1', 'Confidential', 'text' ),
		'term_2'          => array( 'hero', 'Term 2', 'No obligation', 'text' ),
		'term_3'          => array( 'hero', 'Term 3', '48 hours', 'text' ),

		// Stats.
		'stat1_num'       => array( 'stats', 'Stat 1 — number (white part)', '$1.2', 'text' ),
		'stat1_suffix'    => array( 'stats', 'Stat 1 — suffix (accent part)', 'B+', 'text' ),
		'stat1_label'     => array( 'stats', 'Stat 1 — label', 'Closed Volume', 'text' ),
		'stat2_num'       => array( 'stats', 'Stat 2 — number', '300', 'text' ),
		'stat2_suffix'    => array( 'stats', 'Stat 2 — suffix', '+', 'text' ),
		'stat2_label'     => array( 'stats', 'Stat 2 — label', 'Transactions', 'text' ),
		'stat3_num'       => array( 'stats', 'Stat 3 — number', '48', 'text' ),
		'stat3_suffix'    => array( 'stats', 'Stat 3 — suffix', 'hr', 'text' ),
		'stat3_label'     => array( 'stats', 'Stat 3 — label', 'Valuation Turnaround', 'text' ),

		// Statement.
		'statement_main'   => array( 'statement', 'Statement (white part)', 'Most owners leave money on the table.', 'textarea' ),
		'statement_accent' => array( 'statement', 'Statement (accent part)', "We don't let that happen.", 'textarea' ),
		'punch1_title'     => array( 'statement', 'Point 1 — title', 'Off-Market Buyers on File', 'text' ),
		'punch1_text'      => array( 'statement', 'Point 1 — text', 'Funds, exchange buyers, and operators actively hunting in your asset class — before your property ever hits a listing site.', 'textarea' ),
		'punch2_title'     => array( 'statement', 'Point 2 — title', 'Real Numbers, Not Flattery', 'text' ),
		'punch2_text'      => array( 'statement', 'Point 2 — text', 'Cap rates, debt markets, and comp reality — a defensible number you can act on, not a fantasy figure to win your listing.', 'textarea' ),
		'punch3_title'     => array( 'statement', 'Point 3 — title', 'Principals Only', 'text' ),
		'punch3_text'      => array( 'statement', 'Point 3 — text', 'The broker who values your property is the broker who sells it. No junior handoffs, no call centers.', 'textarea' ),

		// Quote.
		'quote_pre'       => array( 'quote', 'Quote (before accent)', '$18.4M industrial exit —', 'textarea' ),
		'quote_accent'    => array( 'quote', 'Quote (accent words)', '11% over', 'text' ),
		'quote_post'      => array( 'quote', 'Quote (after accent)', 'our best in-house estimate. These people move.', 'textarea' ),
		'quote_cite'      => array( 'quote', 'Attribution', 'Owner — 240,000 SF Industrial Portfolio', 'text' ),

		// Final CTA.
		'final_main'      => array( 'final', 'Final headline (white part)', 'Your property.', 'text' ),
		'final_accent'    => array( 'final', 'Final headline (accent part)', 'Its real number.', 'text' ),
		'final_sub'       => array( 'final', 'Final subline', 'Free. Confidential. 48 hours. Zero obligation.', 'text' ),
		'cta_label'       => array( 'final', 'Button label', 'Get the Number', 'text' ),

		// Lead capture.
		'lead_email'      => array( 'leads', 'Send new leads to this email', get_option( 'admin_email' ), 'text' ),
		'form_title'      => array( 'leads', 'Form title', 'Get the number', 'text' ),
		'form_sub'        => array( 'leads', 'Form subtitle', 'Free broker opinion of value. Two steps, 20 seconds.', 'text' ),
		'success_title'   => array( 'leads', 'Success title', 'Locked in.', 'text' ),
		'success_text'    => array( 'leads', 'Success message', 'Your valuation is in the works. Expect it within 48 hours — and a call from a principal broker, not an assistant, to confirm the details.', 'textarea' ),

		// Footer.
		'footer_legal'    => array( 'footer', 'Legal / license line', 'Licensed Commercial Real Estate Brokerage • License #00000000. Broker opinions of value are professional opinions, not formal appraisals. Not intended to solicit properties under exclusive agreement with another brokerage.', 'textarea' ),
	);
}

/** Fetch a Customizer value with its default. */
function meridian_get( $key ) {
	$fields = meridian_fields();
	$default = isset( $fields[ $key ] ) ? $fields[ $key ][2] : '';
	return get_theme_mod( $key, $default );
}

/* ---------------------------------------------------------------
 * Theme setup & assets
 * ------------------------------------------------------------- */
add_action( 'after_setup_theme', function () {
	add_theme_support( 'title-tag' );
} );

add_action( 'wp_enqueue_scripts', function () {
	wp_enqueue_style( 'meridian-style', get_stylesheet_uri(), array(), wp_get_theme()->get( 'Version' ) );
	wp_enqueue_script( 'meridian-app', get_template_directory_uri() . '/assets/app.js', array(), wp_get_theme()->get( 'Version' ), true );
	wp_localize_script( 'meridian-app', 'MERIDIAN', array(
		'endpoint' => esc_url_raw( rest_url( 'meridian/v1/lead' ) ),
	) );

	$accent = meridian_get( 'accent_color' );
	if ( $accent && '#ffb400' !== strtolower( $accent ) ) {
		wp_add_inline_style( 'meridian-style', ':root{--accent:' . sanitize_hex_color( $accent ) . ';}' );
	}
} );

/* ---------------------------------------------------------------
 * Customizer: one section per page area, controls from meridian_fields()
 * ------------------------------------------------------------- */
add_action( 'customize_register', function ( $wp_customize ) {
	$panel = 'meridian_panel';
	$wp_customize->add_panel( $panel, array(
		'title'    => 'Funnel Content',
		'priority' => 10,
	) );

	$sections = array(
		'branding'  => 'Branding & Contact',
		'hero'      => 'Hero',
		'stats'     => 'Stats Strip',
		'statement' => 'Statement Section',
		'quote'     => 'Testimonial Quote',
		'final'     => 'Final Call-to-Action',
		'leads'     => 'Lead Capture Form',
		'footer'    => 'Footer & Legal',
	);
	foreach ( $sections as $id => $title ) {
		$wp_customize->add_section( 'meridian_' . $id, array(
			'title' => $title,
			'panel' => $panel,
		) );
	}

	foreach ( meridian_fields() as $key => $field ) {
		list( $section, $label, $default, $type ) = $field;

		$wp_customize->add_setting( $key, array(
			'default'           => $default,
			'sanitize_callback' => 'color' === $type ? 'sanitize_hex_color' : 'wp_kses_post',
		) );

		if ( 'color' === $type ) {
			$wp_customize->add_control( new WP_Customize_Color_Control( $wp_customize, $key, array(
				'label'   => $label,
				'section' => 'meridian_' . $section,
			) ) );
		} else {
			$wp_customize->add_control( $key, array(
				'label'   => $label,
				'section' => 'meridian_' . $section,
				'type'    => $type,
			) );
		}
	}
} );

/* ---------------------------------------------------------------
 * Leads: custom post type shown in wp-admin
 * ------------------------------------------------------------- */
add_action( 'init', function () {
	register_post_type( 'meridian_lead', array(
		'labels' => array(
			'name'          => 'Leads',
			'singular_name' => 'Lead',
		),
		'public'       => false,
		'show_ui'      => true,
		'menu_icon'    => 'dashicons-phone',
		'menu_position'=> 25,
		'supports'     => array( 'title' ),
		'capabilities' => array( 'create_posts' => 'do_not_allow' ),
		'map_meta_cap' => true,
	) );
} );

add_filter( 'manage_meridian_lead_posts_columns', function ( $columns ) {
	return array(
		'cb'        => $columns['cb'],
		'title'     => 'Lead',
		'address'   => 'Property',
		'asset'     => 'Asset Type',
		'phone'     => 'Phone',
		'email'     => 'Email',
		'date'      => 'Received',
	);
} );

add_action( 'manage_meridian_lead_posts_custom_column', function ( $column, $post_id ) {
	if ( in_array( $column, array( 'address', 'asset', 'phone', 'email' ), true ) ) {
		echo esc_html( get_post_meta( $post_id, $column, true ) );
	}
}, 10, 2 );

/* ---------------------------------------------------------------
 * REST endpoint the form posts to
 * ------------------------------------------------------------- */
add_action( 'rest_api_init', function () {
	register_rest_route( 'meridian/v1', '/lead', array(
		'methods'             => 'POST',
		'callback'            => 'meridian_handle_lead',
		'permission_callback' => '__return_true',
	) );
} );

function meridian_handle_lead( WP_REST_Request $request ) {
	// Honeypot: the hidden "company" field must stay empty (bots fill it).
	if ( '' !== trim( (string) $request->get_param( 'company' ) ) ) {
		return new WP_REST_Response( array( 'ok' => true ), 200 );
	}

	$lead = array(
		'address' => sanitize_text_field( (string) $request->get_param( 'address' ) ),
		'asset'   => sanitize_text_field( (string) $request->get_param( 'asset' ) ),
		'name'    => sanitize_text_field( (string) $request->get_param( 'name' ) ),
		'email'   => sanitize_email( (string) $request->get_param( 'email' ) ),
		'phone'   => sanitize_text_field( (string) $request->get_param( 'phone' ) ),
	);

	if ( strlen( $lead['address'] ) < 5 || strlen( $lead['name'] ) < 2 || ! is_email( $lead['email'] ) ) {
		return new WP_REST_Response( array( 'ok' => false, 'error' => 'invalid' ), 400 );
	}

	$post_id = wp_insert_post( array(
		'post_type'   => 'meridian_lead',
		'post_status' => 'publish',
		'post_title'  => $lead['name'] . ' — ' . $lead['address'],
	) );
	if ( $post_id && ! is_wp_error( $post_id ) ) {
		foreach ( $lead as $key => $value ) {
			update_post_meta( $post_id, $key, $value );
		}
	}

	$to = meridian_get( 'lead_email' );
	if ( is_email( $to ) ) {
		wp_mail(
			$to,
			'New valuation lead: ' . $lead['name'],
			"New lead from your funnel:\n\n"
			. 'Name:     ' . $lead['name'] . "\n"
			. 'Property: ' . $lead['address'] . "\n"
			. 'Asset:    ' . $lead['asset'] . "\n"
			. 'Phone:    ' . $lead['phone'] . "\n"
			. 'Email:    ' . $lead['email'] . "\n\n"
			. 'View all leads: ' . admin_url( 'edit.php?post_type=meridian_lead' ),
			array( 'Reply-To: ' . $lead['email'] )
		);
	}

	return new WP_REST_Response( array( 'ok' => true ), 200 );
}
